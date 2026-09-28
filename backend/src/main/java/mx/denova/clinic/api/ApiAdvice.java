package mx.denova.clinic.api;

import org.springframework.dao.DataIntegrityViolationException;
import org.springframework.http.HttpStatus;
import org.springframework.http.ProblemDetail;
import org.springframework.http.converter.HttpMessageNotReadableException;
import org.springframework.web.bind.MethodArgumentNotValidException;
import org.springframework.web.bind.MissingRequestHeaderException;
import org.springframework.web.bind.annotation.ExceptionHandler;
import org.springframework.web.bind.annotation.RestControllerAdvice;
import org.springframework.web.method.annotation.MethodArgumentTypeMismatchException;

@RestControllerAdvice
public class ApiAdvice {
    @ExceptionHandler(ApiProblem.class)
    ProblemDetail domain(ApiProblem ex) { return problem(ex.status, ex.code, ex.getMessage()); }

    @ExceptionHandler({MethodArgumentNotValidException.class, HttpMessageNotReadableException.class,
            MethodArgumentTypeMismatchException.class, MissingRequestHeaderException.class})
    ProblemDetail invalid(Exception ex) {
        return problem(HttpStatus.BAD_REQUEST, "INVALID_REQUEST", "Revisa los campos, las cantidades y la clave Idempotency-Key (UUID).");
    }
    @ExceptionHandler(DataIntegrityViolationException.class)
    ProblemDetail duplicate(DataIntegrityViolationException ex) {
        return problem(HttpStatus.CONFLICT, "DATA_CONFLICT", "La operación entra en conflicto con un registro existente.");
    }
    private ProblemDetail problem(HttpStatus status, String code, String message) {
        var body = ProblemDetail.forStatusAndDetail(status, message);
        body.setProperty("code", code);
        return body;
    }
}
