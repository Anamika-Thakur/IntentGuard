import { AppError } from '../errors/index.js';
import { getDbClient, IDatabaseClient } from '../db/client.js';
import { validateProposalOutput } from './proposalSchema.js';
import { v4 as uuidv4 } from 'uuid';
import { canonicalizePolicy } from '../crypto/canonical.js';
import { sha256Hex } from '../crypto/hasher.js';

export interface McpToolRequest {
  tool: string;
  arguments: Record<string, unknown>;
  userId: string;
  correlationId?: string | undefined;
}

export interface McpToolResponse {
  tool: string;
  success: boolean;
  result?: unknown;
  error?: string;
}

export const PERMITTED_AGENT_TOOLS = new Set([
  'propose_purchase',
  'get_intent_status',
  'request_validation',
  'request_guarded_capture',
]);

export class McpSecurityBridge {
  constructor(private db: IDatabaseClient = getDbClient()) {}

  async executeTool(req: McpToolRequest): Promise<McpToolResponse> {
    const correlationId = req.correlationId || uuidv4();

    // 1. Least Privilege Check: Disallow unlisted or dangerous tools
    if (!PERMITTED_AGENT_TOOLS.has(req.tool)) {
      await this.logAudit(req.userId, correlationId, 'MCP_UNAUTHORIZED_TOOL_BLOCKED', {
        attemptedTool: req.tool,
      });

      throw AppError.forbidden(
        `Agent tool '${req.tool}' is strictly disallowed. AI agents are restricted to [${Array.from(PERMITTED_AGENT_TOOLS).join(', ')}].`
      );
    }

    await this.logAudit(req.userId, correlationId, 'MCP_TOOL_INVOKED', {
      tool: req.tool,
      arguments: req.arguments,
    });

    switch (req.tool) {
      case 'propose_purchase': {
        const validated = validateProposalOutput(req.arguments);
        const intentId = `int_${uuidv4().replace(/-/g, '')}`;
        const policyId = `pol_${uuidv4().replace(/-/g, '')}`;
        const now = new Date();
        const expiresAt = new Date(now.getTime() + 60 * 60 * 1000); // 1 hour

        const canonicalStr = canonicalizePolicy({
          intentId,
          version: 1,
          merchantId: validated.merchantId,
          allowedSku: validated.sku,
          maxQuantity: validated.maxQuantity,
          maxTotalCents: validated.maxTotalCents,
          currency: validated.currency,
          allowedConditions: null,
        });
        const canonicalHash = sha256Hex(canonicalStr);

        await this.db.query(
          `INSERT INTO intents (id, user_id, status, version, expires_at)
           VALUES ($1, $2, 'DRAFT', 1, $3)`,
          [intentId, req.userId, expiresAt]
        );

        await this.db.query(
          `INSERT INTO intent_policies (
            id, intent_id, version, merchant_id, allowed_sku, max_quantity, max_total_cents, currency, canonical_hash
          ) VALUES ($1, $2, 1, $3, $4, $5, $6, $7, $8)`,
          [
            policyId,
            intentId,
            validated.merchantId,
            validated.sku,
            validated.maxQuantity,
            validated.maxTotalCents,
            validated.currency,
            canonicalHash,
          ]
        );

        return {
          tool: req.tool,
          success: true,
          result: {
            intentId,
            status: 'DRAFT',
            policy: {
              merchantId: validated.merchantId,
              sku: validated.sku,
              maxQuantity: validated.maxQuantity,
              maxTotalCents: validated.maxTotalCents,
              currency: validated.currency,
            },
            approvalRequired: true,
            message: 'Intent created in DRAFT state. The user must review and explicitly approve it before checkout.',
          },
        };
      }

      case 'get_intent_status': {
        const intentId = req.arguments['intentId'] as string;
        if (!intentId) {
          throw AppError.badRequest('Missing intentId argument.');
        }

        const res = await this.db.query(`SELECT * FROM intents WHERE id = $1`, [intentId]);
        if (res.rowCount === 0) {
          throw AppError.notFound(`Intent '${intentId}' not found.`);
        }

        const intent = res.rows[0];
        if (!intent) {
          throw AppError.notFound(`Intent '${intentId}' not found.`);
        }
        if (intent.user_id !== req.userId) {
          throw AppError.forbidden('Access denied to intent.');
        }

        return {
          tool: req.tool,
          success: true,
          result: {
            intentId: intent.id,
            status: intent.status,
            version: intent.version,
            expiresAt: intent.expires_at,
          },
        };
      }

      case 'request_validation':
      case 'request_guarded_capture': {
        return {
          tool: req.tool,
          success: true,
          result: {
            note: 'Agent tool execution delegated to authenticated server route.',
          },
        };
      }

      default:
        throw AppError.badRequest(`Unknown tool '${req.tool}'`);
    }
  }

  private async logAudit(userId: string, correlationId: string, eventType: string, details: Record<string, unknown>) {
    await this.db.query(
      `INSERT INTO audit_events (id, user_id, correlation_id, event_type, resource_type, resource_id, details)
       VALUES ($1, $2, $3, $4, $5, $6, $7)`,
      [
        `aud_${uuidv4().replace(/-/g, '')}`,
        userId,
        correlationId,
        eventType,
        'mcp_tool',
        details['tool'] ? String(details['tool']) : 'mcp',
        JSON.stringify(details),
      ]
    );
  }
}
