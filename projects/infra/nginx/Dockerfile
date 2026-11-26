FROM nginx:1.30-alpine

ENV PORT=10000 \
    APAG_UPSTREAM_PORT=5050 \
    NGINX_ENTRYPOINT_LOCAL_RESOLVERS=1 \
    NGINX_ENVSUBST_FILTER="^(PORT|APAG_UPSTREAM_HOST|APAG_UPSTREAM_PORT|NGINX_LOCAL_RESOLVERS)$"

RUN rm /etc/nginx/conf.d/default.conf
COPY apag.conf.template /etc/nginx/templates/apag.conf.template

EXPOSE 10000
