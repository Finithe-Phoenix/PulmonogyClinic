package mx.denova.clinic;

import com.nimbusds.jose.JWSAlgorithm;
import com.nimbusds.jose.JWSHeader;
import com.nimbusds.jose.crypto.RSASSASigner;
import com.nimbusds.jose.jwk.JWKSet;
import com.nimbusds.jose.jwk.RSAKey;
import com.nimbusds.jose.jwk.gen.RSAKeyGenerator;
import com.nimbusds.jwt.JWTClaimsSet;
import com.nimbusds.jwt.SignedJWT;
import com.sun.net.httpserver.HttpServer;
import java.net.InetSocketAddress;
import java.nio.charset.StandardCharsets;
import java.time.Instant;
import java.util.Date;
import java.util.List;

// Ephemeral signing key only in test sources. No test identity is available in the API jar.
final class JwtFixture implements AutoCloseable {
    final RSAKey key;
    final HttpServer server;
    final String issuer = "https://identity.example.test/clinic";
    JwtFixture() {
        try {
            key = new RSAKeyGenerator(2048).keyID("test-key").generate();
            server = HttpServer.create(new InetSocketAddress("127.0.0.1", 0), 0);
            byte[] jwks = new JWKSet(key.toPublicJWK()).toString().getBytes(StandardCharsets.UTF_8);
            server.createContext("/jwks", exchange -> {
                exchange.getResponseHeaders().set("Content-Type", "application/json");
                exchange.sendResponseHeaders(200, jwks.length);
                try (var response = exchange.getResponseBody()) { response.write(jwks); }
            });
            server.start();
        } catch (Exception ex) { throw new IllegalStateException(ex); }
    }
    String uri() { return "http://127.0.0.1:" + server.getAddress().getPort() + "/jwks"; }
    String token(String subject, String role) { return token(subject, role, issuer, "clinic-api", Instant.now().plusSeconds(300)); }
    String token(String subject, String role, String tokenIssuer, String audience, Instant expiry) {
        try {
            var claims = new JWTClaimsSet.Builder().subject(subject).issuer(tokenIssuer).audience(audience)
                .issueTime(Date.from(Instant.now().minusSeconds(600))).expirationTime(expiry == null ? null : Date.from(expiry))
                .claim("roles", List.of(role)).build();
            var jwt = new SignedJWT(new JWSHeader.Builder(JWSAlgorithm.RS256).keyID(key.getKeyID()).build(), claims);
            jwt.sign(new RSASSASigner(key));
            return jwt.serialize();
        } catch (Exception ex) { throw new IllegalStateException(ex); }
    }
    @Override public void close() { server.stop(0); }
}
