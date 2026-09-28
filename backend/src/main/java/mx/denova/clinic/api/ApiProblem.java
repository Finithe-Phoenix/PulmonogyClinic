package mx.denova.clinic.api;

import org.springframework.http.HttpStatus;

public class ApiProblem extends RuntimeException {
    public final HttpStatus status;
    public final String code;
    public ApiProblem(HttpStatus status, String code, String message) {
        super(message); this.status = status; this.code = code;
    }
    public static ApiProblem conflict(String code, String message) { return new ApiProblem(HttpStatus.CONFLICT, code, message); }
    public static ApiProblem missing() { return new ApiProblem(HttpStatus.NOT_FOUND, "NOT_FOUND", "El registro no existe."); }
}
