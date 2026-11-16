# The hosted service's Keycloak, with its build options baked in so it starts with
# `start --optimized` instead of rebuilding itself at every start. Built from the repository
# root: `docker build -f deploy/keycloak/Dockerfile .`. It holds no realm, secret or setting:
# the deployment supplies those at run time.
#
# A cold start of the stock image runs Keycloak's build step before anything else, which on one
# vCPU adds tens of seconds to the first sign-in after the service scaled to zero.

FROM docker.io/keycloak/keycloak:26.7.5@sha256:37dbaf6f0722c9ec246335f36e1ef8b2e6cb960f7c27e0d8c615121a3d475a85 AS build

# Build options only. Run-time options (database URL, credentials, hostname, proxy headers) stay
# with the deployment. A deployment that sets a different value for one of these must rebuild.
ENV KC_DB=postgres \
    KC_HEALTH_ENABLED=true \
    KC_CACHE=local
RUN /opt/keycloak/bin/kc.sh build

FROM docker.io/keycloak/keycloak:26.7.5@sha256:37dbaf6f0722c9ec246335f36e1ef8b2e6cb960f7c27e0d8c615121a3d475a85
COPY --from=build /opt/keycloak/ /opt/keycloak/
ENV KC_DB=postgres \
    KC_HEALTH_ENABLED=true \
    KC_CACHE=local
ENTRYPOINT ["/opt/keycloak/bin/kc.sh"]
CMD ["start", "--optimized"]
