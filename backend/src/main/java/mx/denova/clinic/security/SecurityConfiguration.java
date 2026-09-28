package mx.denova.clinic.security;

import java.util.List;
import java.util.Set;
import org.springframework.context.annotation.Bean;
import org.springframework.context.annotation.Configuration;
import org.springframework.http.HttpMethod;
import org.springframework.security.config.annotation.web.builders.HttpSecurity;
import org.springframework.security.config.http.SessionCreationPolicy;
import org.springframework.security.core.authority.SimpleGrantedAuthority;
import org.springframework.security.oauth2.server.resource.authentication.JwtAuthenticationConverter;
import org.springframework.security.web.SecurityFilterChain;

@Configuration
public class SecurityConfiguration {
    @Bean SecurityFilterChain security(HttpSecurity http) throws Exception {
        var converter = new JwtAuthenticationConverter();
        converter.setJwtGrantedAuthoritiesConverter(jwt -> {
            Object claim = jwt.getClaims().get("roles");
            if (!(claim instanceof List<?> roles)) return List.of();
            return roles.stream().filter(String.class::isInstance).map(String.class::cast)
                    .filter(Set.of("ADMIN", "FARMACIA", "AUDITOR", "RECEPCION")::contains)
                    .map(role -> new SimpleGrantedAuthority("ROLE_" + role))
                    .map(org.springframework.security.core.GrantedAuthority.class::cast).toList();
        });
        return http
            // Only Authorization: Bearer is accepted; no cookie/session/basic login.
            .csrf(csrf -> csrf.disable())
            .sessionManagement(session -> session.sessionCreationPolicy(SessionCreationPolicy.STATELESS))
            .authorizeHttpRequests(auth -> auth
                .requestMatchers(HttpMethod.GET, "/health").permitAll()
                .requestMatchers(HttpMethod.GET, "/api/v1/audit/events").hasAnyRole("ADMIN", "AUDITOR")
                .requestMatchers(HttpMethod.GET, "/api/v1/inventory/**").hasAnyRole("ADMIN", "FARMACIA", "AUDITOR")
                .requestMatchers(HttpMethod.POST, "/api/v1/inventory/products").hasRole("ADMIN")
                .requestMatchers(HttpMethod.POST, "/api/v1/inventory/lots/*/quarantine").hasRole("ADMIN")
                .requestMatchers(HttpMethod.POST, "/api/v1/inventory/lots", "/api/v1/inventory/lots/*/movements").hasAnyRole("ADMIN", "FARMACIA")
                .anyRequest().denyAll())
            .oauth2ResourceServer(resource -> resource.jwt(jwt -> jwt.jwtAuthenticationConverter(converter)))
            .build();
    }
}
