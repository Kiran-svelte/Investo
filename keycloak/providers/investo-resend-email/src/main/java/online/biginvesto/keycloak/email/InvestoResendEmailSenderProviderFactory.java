package online.biginvesto.keycloak.email;

import org.keycloak.Config;
import org.keycloak.email.EmailSenderProvider;
import org.keycloak.email.EmailSenderProviderFactory;
import org.keycloak.models.KeycloakSession;
import org.keycloak.models.KeycloakSessionFactory;

public class InvestoResendEmailSenderProviderFactory implements EmailSenderProviderFactory {

    public static final String PROVIDER_ID = "investo-resend";

    @Override
    public EmailSenderProvider create(KeycloakSession session) {
        return new InvestoResendEmailSenderProvider(session);
    }

    @Override
    public void init(Config.Scope config) {
        // env-driven
    }

    @Override
    public void postInit(KeycloakSessionFactory factory) {
        // no-op
    }

    @Override
    public void close() {
        // no-op
    }

    @Override
    public String getId() {
        return PROVIDER_ID;
    }
}
