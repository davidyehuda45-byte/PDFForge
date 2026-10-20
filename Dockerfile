FROM golang:1.24-alpine AS build
WORKDIR /src
COPY go.mod ./
COPY go.sum ./
COPY cmd ./cmd
RUN CGO_ENABLED=0 go build -trimpath -ldflags="-s -w" -o /out/pdfforge ./cmd/server

FROM python:3.12-slim
ENV PYTHONDONTWRITEBYTECODE=1 PYTHONUNBUFFERED=1
WORKDIR /app
RUN useradd --system --uid 10001 --create-home appuser
COPY requirements.txt ./
RUN pip install --no-cache-dir -r requirements.txt
COPY --from=build /out/pdfforge ./pdfforge
COPY worker ./worker
COPY web ./web
RUN mkdir -p /app/storage && chown -R appuser:appuser /app
USER appuser
EXPOSE 8080
VOLUME ["/app/storage"]
ENTRYPOINT ["./pdfforge"]
