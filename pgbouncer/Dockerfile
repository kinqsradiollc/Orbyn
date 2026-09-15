# PgBouncer from Alpine's own package: pools thousands of client connections
# onto a few dozen Postgres connections. Built locally; no third-party image.
FROM alpine:3.20
# Alpine's package does not create a service account, so add one.
RUN apk add --no-cache pgbouncer \
 && addgroup -S pgbouncer && adduser -S -D -H -G pgbouncer pgbouncer \
 && mkdir -p /etc/pgbouncer /var/run/pgbouncer \
 && chown -R pgbouncer:pgbouncer /etc/pgbouncer /var/run/pgbouncer
COPY pgbouncer.base.ini /etc/pgbouncer/pgbouncer.base.ini
COPY --chmod=755 entrypoint.sh /usr/local/bin/entrypoint.sh
# A checkout with Windows line endings would otherwise fail to start with
# "exec /usr/local/bin/entrypoint.sh: no such file or directory".
RUN sed -i 's/\r$//' /usr/local/bin/entrypoint.sh /etc/pgbouncer/pgbouncer.base.ini
USER pgbouncer
EXPOSE 6432
ENTRYPOINT ["/usr/local/bin/entrypoint.sh"]
