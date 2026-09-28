FROM maven:3.9.11-eclipse-temurin-21 AS build
WORKDIR /build
COPY pom.xml .
RUN --mount=type=cache,target=/root/.m2 mvn -B -ntp dependency:go-offline
COPY src ./src
RUN --mount=type=cache,target=/root/.m2 mvn -B -ntp -DskipTests package
FROM eclipse-temurin:21-jre
WORKDIR /app
COPY --from=build /build/target/clinic-api-*.jar app.jar
USER 10001:10001
ENTRYPOINT ["java", "-jar", "/app/app.jar"]
