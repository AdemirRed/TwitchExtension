/**
 * Criptografia AES-256-GCM para tokens OAuth no banco de dados.
 * Mesmo que o banco seja comprometido, os tokens são inutilizáveis sem a ENCRYPTION_KEY.
 *
 * Formato armazenado: iv:authTag:dadosCriptografados (tudo em hex)
 */
const crypto = require('crypto');

const ALGO = 'aes-256-gcm';

function getKey() {
  const k = process.env.ENCRYPTION_KEY;
  if (!k || k.length !== 64) {
    // Em dev sem key, usa chave nula (avisa mas não trava)
    if (process.env.NODE_ENV !== 'production') {
      return Buffer.alloc(32);
    }
    throw new Error('ENCRYPTION_KEY ausente ou inválida. Deve ter 64 caracteres hex (32 bytes).');
  }
  return Buffer.from(k, 'hex');
}

function encrypt(texto) {
  if (!texto) return texto;
  try {
    const key    = getKey();
    const iv     = crypto.randomBytes(16);
    const cipher = crypto.createCipheriv(ALGO, key, iv);
    const enc    = Buffer.concat([cipher.update(texto, 'utf8'), cipher.final()]);
    const tag    = cipher.getAuthTag();
    return `${iv.toString('hex')}:${tag.toString('hex')}:${enc.toString('hex')}`;
  } catch (e) {
    console.error('[crypto] Erro ao criptografar:', e.message);
    return texto; // fallback sem criptografia em dev
  }
}

function decrypt(texto) {
  if (!texto) return texto;
  // Se não estiver no formato criptografado (legado plaintext), retorna como está
  const partes = texto.split(':');
  if (partes.length !== 3) return texto;
  try {
    const key     = getKey();
    const iv      = Buffer.from(partes[0], 'hex');
    const tag     = Buffer.from(partes[1], 'hex');
    const enc     = Buffer.from(partes[2], 'hex');
    const decipher = crypto.createDecipheriv(ALGO, key, iv);
    decipher.setAuthTag(tag);
    return Buffer.concat([decipher.update(enc), decipher.final()]).toString('utf8');
  } catch {
    // Falha na descriptografia → provavelmente era plaintext antigo
    return texto;
  }
}

module.exports = { encrypt, decrypt };
