package online.biginvesto.keycloak.email;

import org.jboss.logging.Logger;
import org.keycloak.email.EmailException;
import org.keycloak.email.EmailSenderProvider;
import org.keycloak.models.KeycloakSession;
import org.keycloak.models.UserModel;

import java.net.URI;
import java.net.http.HttpClient;
import java.net.http.HttpRequest;
import java.net.http.HttpResponse;
import java.nio.charset.StandardCharsets;
import java.time.Duration;
import java.util.Map;

/**
 * Sends Keycloak transactional mail through Resend HTTP API.
 * Railway blocks/unreliably routes SMTP from Keycloak; Resend HTTP works globally.
 */
public class InvestoResendEmailSenderProvider implements EmailSenderProvider {

    private static final Logger LOG = Logger.getLogger(InvestoResendEmailSenderProvider.class);
    private static final HttpClient HTTP = HttpClient.newBuilder()
            .connectTimeout(Duration.ofSeconds(15))
            .build();

    public InvestoResendEmailSenderProvider(KeycloakSession session) {
        // session reserved for future realm-scoped config
    }

    @Override
    public void send(Map<String, String> config, UserModel user, String subject, String textBody, String htmlBody)
            throws EmailException {
        String address = user != null ? user.getEmail() : null;
        if (address == null || address.isBlank()) {
            throw new EmailException("No email address configured for the user");
        }
        send(config, address, subject, textBody, htmlBody);
    }

    @Override
    public void send(Map<String, String> config, String address, String subject, String textBody, String htmlBody)
            throws EmailException {
        String apiKey = firstNonBlank(
                System.getenv("RESEND_API_KEY"),
                System.getenv("KC_RESEND_API_KEY")
        );
        if (apiKey == null || apiKey.isBlank()) {
            throw new EmailException("RESEND_API_KEY is not configured on the Keycloak service");
        }

        String from = firstNonBlank(
                System.getenv("MAIL_FROM"),
                System.getenv("KC_MAIL_FROM"),
                config != null ? config.get("from") : null
        );
        if (from == null || from.isBlank()) {
            throw new EmailException("MAIL_FROM is not configured on the Keycloak service");
        }

        String json = buildPayload(from, address, subject, textBody, htmlBody);
        HttpRequest request = HttpRequest.newBuilder()
                .uri(URI.create("https://api.resend.com/emails"))
                .timeout(Duration.ofSeconds(30))
                .header("Authorization", "Bearer " + apiKey.trim())
                .header("Content-Type", "application/json")
                .POST(HttpRequest.BodyPublishers.ofString(json, StandardCharsets.UTF_8))
                .build();

        try {
            HttpResponse<String> response = HTTP.send(request, HttpResponse.BodyHandlers.ofString());
            if (response.statusCode() < 200 || response.statusCode() >= 300) {
                LOG.errorf("Resend HTTP send failed status=%d body=%s", response.statusCode(), response.body());
                throw new EmailException("Resend rejected email: HTTP " + response.statusCode());
            }
            LOG.debugf("Resend email queued for %s", maskEmail(address));
        } catch (EmailException e) {
            throw e;
        } catch (Exception e) {
            LOG.error("Resend HTTP send failed", e);
            throw new EmailException("Failed to send email through Resend HTTP API", e);
        }
    }

    @Override
    public void validate(Map<String, String> config) throws EmailException {
        String apiKey = firstNonBlank(System.getenv("RESEND_API_KEY"), System.getenv("KC_RESEND_API_KEY"));
        if (apiKey == null || apiKey.isBlank()) {
            throw new EmailException("RESEND_API_KEY is not configured on the Keycloak service");
        }
        String from = firstNonBlank(
                System.getenv("MAIL_FROM"),
                System.getenv("KC_MAIL_FROM"),
                config != null ? config.get("from") : null
        );
        if (from == null || from.isBlank()) {
            throw new EmailException("MAIL_FROM is not configured on the Keycloak service");
        }
    }

    @Override
    public void close() {
        // no-op
    }

    private static String buildPayload(String from, String to, String subject, String textBody, String htmlBody) {
        StringBuilder sb = new StringBuilder(512);
        sb.append('{');
        appendJsonField(sb, "from", from);
        sb.append(',');
        sb.append("\"to\":[\"");
        sb.append(escapeJson(to.trim()));
        sb.append("\"],");
        appendJsonField(sb, "subject", subject != null ? subject : "Investo notification");
        if (htmlBody != null && !htmlBody.isBlank()) {
            sb.append(',');
            appendJsonField(sb, "html", htmlBody);
        }
        if (textBody != null && !textBody.isBlank()) {
            sb.append(',');
            appendJsonField(sb, "text", textBody);
        } else if (htmlBody == null || htmlBody.isBlank()) {
            sb.append(',');
            appendJsonField(sb, "text", subject != null ? subject : "Investo notification");
        }
        sb.append('}');
        return sb.toString();
    }

    private static void appendJsonField(StringBuilder sb, String key, String value) {
        sb.append('"').append(key).append("\":\"").append(escapeJson(value)).append('"');
    }

    private static String escapeJson(String value) {
        return value
                .replace("\\", "\\\\")
                .replace("\"", "\\\"")
                .replace("\n", "\\n")
                .replace("\r", "\\r");
    }

    private static String firstNonBlank(String... values) {
        if (values == null) {
            return null;
        }
        for (String value : values) {
            if (value != null && !value.isBlank()) {
                return value.trim();
            }
        }
        return null;
    }

    private static String maskEmail(String email) {
        int at = email.indexOf('@');
        if (at <= 1) {
            return "***";
        }
        return email.charAt(0) + "***" + email.substring(at);
    }
}
