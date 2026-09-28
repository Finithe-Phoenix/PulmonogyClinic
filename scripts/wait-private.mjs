const endpoints = ['http://localhost:8180/realms/clinic-dev/.well-known/openid-configuration', 'http://localhost:8181/health', 'http://localhost:4180/'];
const deadline = Date.now() + 180000;
for (const endpoint of endpoints) {
  for (;;) {
    try { const response = await fetch(endpoint, { signal: AbortSignal.timeout(3000) }); if (response.ok) break; } catch {}
    if (Date.now() > deadline) throw new Error('El entorno privado no estuvo listo dentro de 180 segundos.');
    await new Promise(resolve => setTimeout(resolve, 1500));
  }
}
console.log('Portal, identidad y proceso API disponibles. Las pruebas verificarán la operación.');
