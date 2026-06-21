FROM maven:3.9.9-eclipse-temurin-17 AS provider-build
WORKDIR /build
COPY providers/investo-resend-email/pom.xml ./pom.xml
COPY providers/investo-resend-email/src ./src
RUN mvn -q package -DskipTests

FROM quay.io/keycloak/keycloak:26.0.5

COPY --from=provider-build /build/target/investo-resend-email-1.0.0.jar /opt/keycloak/providers/investo-resend-email.jar

ENV KC_HEALTH_ENABLED=true
ENV KC_METRICS_ENABLED=true

RUN /opt/keycloak/bin/kc.sh build \
  --spi-email-sender-default-provider=investo-resend \
  --spi-email-sender-investo-resend-enabled=true

ENTRYPOINT ["/opt/keycloak/bin/kc.sh"]
CMD ["start", "--optimized"]
