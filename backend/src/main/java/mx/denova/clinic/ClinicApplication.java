package mx.denova.clinic;

import java.time.Clock;
import java.time.ZoneId;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.boot.SpringApplication;
import org.springframework.boot.autoconfigure.SpringBootApplication;
import org.springframework.context.annotation.Bean;

@SpringBootApplication
public class ClinicApplication {
    public static void main(String[] args) { SpringApplication.run(ClinicApplication.class, args); }
    @Bean Clock clinicClock(@Value("${clinic.timezone}") String timezone) {
        return Clock.system(ZoneId.of(timezone));
    }
}
