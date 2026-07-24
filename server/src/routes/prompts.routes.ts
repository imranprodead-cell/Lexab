/** «Улучшить промпт»: кнопка в композере переписывает черновик пользователя
 *  в чёткий структурированный запрос (модель — DeepSeek, см. improvePrompt). */
import type { FastifyInstance } from 'fastify';
import { improvePrompt } from '../llm.ts';
import { asObject, requireString } from '../lib/validate.ts';

export function promptRoutes(app: FastifyInstance): void {
  app.post(
    '/prompts/improve',
    // authenticateReal: невалидный/просроченный токен не должен жечь платный
    // LLM-ключ. Месячная AI-квота НЕ списывается: это микрозапрос на самой
    // дешёвой модели, а списание было бы двойным счётом за одно действие
    // (улучшить + отправить). Злоупотребление закрыто лимитом 10/мин и
    // потолком 4000 символов.
    { preHandler: [app.authenticateReal], config: { rateLimit: { max: 10, timeWindow: '1 minute' } } },
    async (req) => {
      const body = asObject(req.body);
      const text = requireString(body, 'text', { min: 3, max: 4000 });
      return { text: await improvePrompt(text) };
    },
  );
}
