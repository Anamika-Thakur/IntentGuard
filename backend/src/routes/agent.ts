import { Router, Request, Response, NextFunction } from 'express';
import { z } from 'zod';
import { requireAuth } from '../middleware/auth.js';
import { AppError } from '../errors/index.js';
import {
  sanitizeNaturalLanguageRequest,
  parseNaturalLanguageToProposal,
  validateProposalOutput,
} from '../agent/proposalSchema.js';
import { McpSecurityBridge } from '../agent/mcpBridge.js';
import { getDbClient } from '../db/client.js';

export function createAgentRouter(): Router {
  const router = Router();
  const db = getDbClient();
  const mcpBridge = new McpSecurityBridge(db);

  router.use(requireAuth);

  const proposeSchema = z.object({
    prompt: z.string().min(1),
    extractedProposal: z.record(z.unknown()).optional(),
  });

  /**
   * POST /api/agent/propose
   * Submits a natural-language purchase request.
   * Sanitizes input against prompt injection and creates a typed draft proposal.
   */
  router.post('/propose', async (req: Request, res: Response, next: NextFunction) => {
    try {
      const { prompt, extractedProposal } = proposeSchema.parse(req.body);
      const cleanPrompt = sanitizeNaturalLanguageRequest(prompt);

      let proposal = extractedProposal;
      if (!proposal) {
        proposal = parseNaturalLanguageToProposal(cleanPrompt);
      }

      // Strict validation of the proposal
      const validated = validateProposalOutput(proposal);

      res.status(200).json({
        sanitizedPrompt: cleanPrompt,
        proposal: validated,
        status: 'PROPOSAL_READY_FOR_CONFIRMATION',
        message:
          'Purchase proposal parsed and validated. To proceed, submit to POST /api/intents and complete explicit user approval.',
      });
    } catch (err) {
      if (err instanceof z.ZodError) {
        return next(AppError.badRequest('Invalid agent propose request schema', err.errors));
      }
      next(err);
    }
  });

  const mcpSchema = z.object({
    tool: z.string().min(1),
    arguments: z.record(z.unknown()).default({}),
  });

  /**
   * POST /api/agent/mcp
   * Secure MCP tool boundary.
   */
  router.post('/mcp', async (req: Request, res: Response, next: NextFunction) => {
    try {
      const { tool, arguments: args } = mcpSchema.parse(req.body);
      const userId = req.user!.id;

      const result = await mcpBridge.executeTool({
        tool,
        arguments: args,
        userId,
        correlationId: (req as unknown as { id?: string }).id,
      });

      res.status(200).json(result);
    } catch (err) {
      if (err instanceof z.ZodError) {
        return next(AppError.badRequest('Invalid MCP request format', err.errors));
      }
      next(err);
    }
  });

  return router;
}
