// Пересылает короткую запись в AudD. Ключ приходит от самого приложения и нигде не хранится.
exports.handler = async (event) => {
  const headers = { 'content-type': 'application/json', 'access-control-allow-origin': '*' };
  if (event.httpMethod === 'OPTIONS') return { statusCode: 204, headers: { ...headers, 'access-control-allow-headers': 'content-type', 'access-control-allow-methods': 'POST' }, body: '' };
  if (event.httpMethod !== 'POST') return { statusCode: 405, headers, body: JSON.stringify({ status: 'error', error: { error_message: 'POST only' } }) };
  try {
    const { token, audio } = JSON.parse(event.body || '{}');
    if (!token || !audio) return { statusCode: 400, headers, body: JSON.stringify({ status: 'error', error: { error_code: 700, error_message: 'no token or audio' } }) };
    const form = new FormData();
    form.append('api_token', token);
    form.append('return', 'apple_music,spotify');
    form.append('file', new Blob([Buffer.from(audio, 'base64')], { type: 'audio/wav' }), 'clip.wav');
    const r = await fetch('https://api.audd.io/', { method: 'POST', body: form });
    return { statusCode: 200, headers, body: await r.text() };
  } catch (e) {
    return { statusCode: 502, headers, body: JSON.stringify({ status: 'error', error: { error_message: 'proxy failed' } }) };
  }
};
