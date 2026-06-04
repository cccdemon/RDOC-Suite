# syntax=docker/dockerfile:1.7

FROM prom/prometheus:v3.0.1

COPY apps/monitoring/prometheus.yml /etc/prometheus/prometheus.yml
COPY apps/monitoring/alerts.yml /etc/prometheus/alerts.yml

EXPOSE 9090
ENTRYPOINT ["/bin/prometheus"]
CMD ["--config.file=/etc/prometheus/prometheus.yml", "--storage.tsdb.path=/prometheus", "--web.console.libraries=/usr/share/prometheus/console_libraries", "--web.console.templates=/usr/share/prometheus/consoles"]
