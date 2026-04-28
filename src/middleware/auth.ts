import { Request, Response, NextFunction } from 'express';
import { Bot } from '../models';

export const requireApiKey = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
  try {
    const authHeader = req.headers.authorization;
    const botId = req.headers['x-bot-id'] as string; // Cordia SDK sends this

    if (!authHeader || !authHeader.startsWith('Bearer ')) {
       res.status(401).json({ 
         success: false, 
         error: 'Authorization header missing or invalid format (Bearer token required)',
         code: 'AUTH_MISSING'
       });
       return;
    }

    if (!botId) {
      res.status(400).json({ 
        success: false, 
        error: 'X-Bot-Id header is required',
        code: 'BOT_ID_MISSING'
      });
      return;
    }

    // Find bot by botId
    const bot = await Bot.findOne({ botId });

    if (!bot) {
      res.status(404).json({ 
        success: false, 
        error: 'Bot not found. It may have been deleted from the Cordia dashboard.',
        code: 'BOT_NOT_FOUND'
      });
      return;
    }

    // PUBLIC ACCESS EXCEPTION: 
    // Allow GET /summary for public bots even without a valid API key header
    const isSummaryRequest = req.method === 'GET' && req.path.includes('/summary');
    if (isSummaryRequest && bot.isPublic) {
      (req as any).bot = bot;
      return next();
    }

    // Standard API Key verification for all other requests
    if (!authHeader || !authHeader.startsWith('Bearer ')) {
       res.status(401).json({ 
         success: false, 
         error: 'Authorization header missing or invalid format (Bearer token required)',
         code: 'AUTH_MISSING'
       });
       return;
    }

    const apiKey = authHeader.split(' ')[1];
    if (apiKey !== bot.apiKey) {
      res.status(401).json({ 
        success: false, 
        error: 'Invalid API Key. Your key may have been regenerated. Check your Cordia dashboard for the latest key.',
        code: 'INVALID_API_KEY'
      });
      return;
    }

    // Attach bot to request for downstream usage
    (req as any).bot = bot;
    
    next();
  } catch (error) {
    console.error('Auth middleware error:', error);
    // Return a safe error that won't crash the SDK/bot
    res.status(500).json({ 
      success: false, 
      error: 'Cordia API temporarily unavailable. Your bot will continue to function normally.',
      code: 'INTERNAL_ERROR'
    });
  }
};
