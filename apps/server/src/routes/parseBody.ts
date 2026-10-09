import type { Context } from 'hono';
import { HTTPException } from 'hono/http-exception';
import type { z } from 'zod';

/** リクエストボディを schema で検証して返す。不正なら 400 で打ち切る */
export async function parseBody<S extends z.ZodType>(c: Context, schema: S): Promise<z.infer<S>> {
  const result = schema.safeParse(await c.req.json().catch(() => undefined));
  if (!result.success) throw new HTTPException(400, { message: result.error.message });
  return result.data;
}
