/** GET /me | PATCH /me | GET|POST /me/digest | GET /me/intake */
import type { FastifyInstance } from 'fastify';
import { config } from '../config.ts';
import type { Db } from '../db.ts';
import { badRequest, HttpError } from '../lib/errors.ts';
import { audit } from '../lib/audit.ts';
import { verifyPassword } from '../lib/passwords.ts';
import { asObject, optionalString } from '../lib/validate.ts';
import { getUserByEmail, getUserById, toProfile, type UserRow } from '../plugins/auth.ts';
import { startEmailChange } from './auth.routes.ts';
import { consumeBackupCode, verifyUserTotp } from './security.routes.ts';
import { resolveTeamName } from './team.routes.ts';

export function userRoutes(app: FastifyInstance, db: Db): void {
  app.get('/me', { preHandler: [app.authenticate] }, async (req) => ({
    ...toProfile(req.currentUser),
    teamName: await resolveTeamName(db, req.currentUser.id),
  }));

  // Понедельничная сводка: отдельная пара ручек, а не поле профиля — профиль
  // собирается из UserRow, и лишняя колонка тянула бы правку всех SELECT'ов
  // горячего пути аутентификации.
  app.get('/me/digest', { preHandler: [app.authenticate] }, async (req) => {
    const res = await db.query<{ weekly_digest: boolean }>('SELECT weekly_digest FROM users WHERE id = $1', [req.currentUser.id]);
    return { enabled: res.rows[0]?.weekly_digest ?? true };
  });

  app.post('/me/digest', { preHandler: [app.authenticate] }, async (req) => {
    const body = asObject(req.body);
    if (typeof body.enabled !== 'boolean') throw badRequest('Поле "enabled" — true или false');
    await db.query('UPDATE users SET weekly_digest = $2 WHERE id = $1', [req.currentUser.id, body.enabled]);
    return { enabled: body.enabled };
  });

  // Приём договоров по email: адрес-витрина для карточки в Настройках.
  // Маршрутизация всё равно по ОТПРАВИТЕЛЮ (inbound.routes), поэтому письмо
  // должно уходить с почты аккаунта — фронт объясняет это рядом с адресом.
  app.get('/me/intake', { preHandler: [app.authenticate] }, async () => ({
    enabled: Boolean(config.inboundEmailToken && config.inboundEmailAddress),
    address: config.inboundEmailAddress || null,
  }));

  app.patch('/me', { preHandler: [app.authenticate] }, async (req) => {
    const body = asObject(req.body);
    const patch: Record<string, string | null | boolean> = {};
    let emailChangedTo: string | null = null;

    // Server-side bounds mirror the client's (never trust the client alone):
    // free-text fields are capped, so a crafted PATCH can't store megabytes
    // into a profile column.
    const name = optionalString(body, 'name', { max: 200 });
    if (name !== undefined) {
      if (!name.trim()) throw badRequest('Name cannot be empty');
      patch.name = name.trim();
    }
    const firm = optionalString(body, 'firm', { max: 200 });
    if (firm !== undefined) patch.firm = firm;
    const jurisdiction = optionalString(body, 'jurisdiction', { max: 120 });
    if (jurisdiction !== undefined) patch.jurisdiction = jurisdiction;
    const email = optionalString(body, 'email', { max: 320 });
    if (email !== undefined) {
      const lower = email.toLowerCase();
      if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(lower)) throw badRequest('Invalid email address');
      if (lower !== req.currentUser.email.toLowerCase()) {
        // Clean 409 instead of a raw UNIQUE-violation 500 on a taken address.
        const taken = await db.query('SELECT 1 FROM users WHERE lower(email) = $1 AND id <> $2', [lower, req.currentUser.id]);
        if (taken.rows.length) throw new HttpError(409, 'Этот email уже занят / This email is already in use');

        // Почта аккаунта — это ключ восстановления доступа, поэтому её смена
        // требует того же уровня доказательств, что и отключение 2FA: пароль
        // (+ второй фактор, если включён). Раньше хватало живого токена, и
        // украденная сессия давала необратимый захват аккаунта.
        const account = await getUserByEmail(db, req.currentUser.email);
        if (!account) throw new HttpError(401, 'Не удалось подтвердить аккаунт / Could not verify the account');
        if (account.google_sub && !account.password_hash) {
          throw badRequest(
            'Адрес аккаунта задаётся входом через Google — смените его в Google-аккаунте. / ' +
              'Your account address comes from Google sign-in — change it in your Google account.',
          );
        }
        const password = typeof body.currentPassword === 'string' ? body.currentPassword : '';
        if (!password || !(await verifyPassword(password, account.password_hash))) {
          throw new HttpError(401, 'Введите текущий пароль / Enter your current password', 'password_required');
        }
        const totp = await verifyUserTotp(db, req.currentUser.id, typeof body.code === 'string' ? body.code : undefined);
        if (totp === 'required' || totp === 'replay') {
          const backup = typeof body.backupCode === 'string' ? body.backupCode : undefined;
          const used = backup ? await consumeBackupCode(db, req.currentUser.id, backup) : false;
          if (!used) throw new HttpError(401, 'Нужен код двухфакторной аутентификации / Two-factor code required', 'totp_required');
        }
        // Адрес НЕ меняется здесь: он живёт в pending_email до подтверждения по
        // ссылке из письма (POST /auth/confirm-email). Так владелец старого
        // ящика успевает вмешаться, а не узнаёт о захвате по невозможности войти.
        emailChangedTo = lower;
      }
    }
    const initials = optionalString(body, 'initials', { max: 8 });
    if (initials !== undefined) patch.initials = initials;
    // Avatars arrive as data-URLs (bounded well under the 12 MB body limit) or
    // as provider https URLs; anything else (javascript:, file:, …) is refused.
    const avatarUrl = optionalString(body, 'avatarUrl', { max: 8_000_000 });
    if (avatarUrl !== undefined) {
      if (avatarUrl !== '' && !/^(data:image\/|https?:\/\/)/.test(avatarUrl)) {
        throw badRequest('Field "avatarUrl" must be a data:image/… or http(s) URL');
      }
      patch.avatar_url = avatarUrl === '' ? null : avatarUrl; // '' clears the photo
    }

    // Keep initials in sync when the name changes and no explicit override came in.
    if (typeof patch.name === 'string' && initials === undefined) {
      const parts = patch.name.split(/\s+/).filter(Boolean);
      patch.initials =
        parts.length === 1
          ? parts[0].slice(0, 2).toUpperCase()
          : (parts[0][0] + parts[parts.length - 1][0]).toUpperCase();
    }

    const keys = Object.keys(patch);
    if (keys.length) {
      const sets = keys.map((k, i) => `${k} = $${i + 2}`).join(', ');
      await db.query(`UPDATE users SET ${sets} WHERE id = $1`, [req.currentUser.id, ...keys.map((k) => patch[k])]);
    }
    // Смена почты: письмо-подтверждение на НОВЫЙ адрес и предупреждение на
    // СТАРЫЙ (владелец должен узнать о попытке немедленно), плюс запись в аудит.
    if (emailChangedTo) {
      const displayName = typeof patch.name === 'string' ? patch.name : req.currentUser.name;
      await startEmailChange(db, req.currentUser.id, req.currentUser.email, emailChangedTo, displayName);
      await audit(db, req, {
        type: 'user.email_change_requested',
        teamOwnerId: req.currentUser.id,
        target: { type: 'user', id: req.currentUser.id, label: emailChangedTo },
      });
    }
    const user = (await getUserById(db, req.currentUser.id)) as UserRow;
    return { ...toProfile(user), teamName: await resolveTeamName(db, req.currentUser.id) };
  });
}
