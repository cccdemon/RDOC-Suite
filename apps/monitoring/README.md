# RDOC Suite Monitoring

Dedicated Prometheus image for the RDOC Suite microservice deployment.

Build from the repository root:

```bash
docker build -f apps/monitoring/Dockerfile -t rdoc-suite-monitoring:latest .
```

Production compose exposes the web UI behind `https://suite.raumdock.org/monitoring`.
