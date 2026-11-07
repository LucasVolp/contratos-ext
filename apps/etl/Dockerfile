FROM golang:1.24-alpine AS build
WORKDIR /src
COPY go.mod go.sum ./
RUN go mod download
COPY cmd cmd
COPY internal internal
RUN CGO_ENABLED=0 go build -trimpath -ldflags="-s -w" -o /out/replicator ./cmd/replicator

FROM alpine:3.20
RUN apk add --no-cache ca-certificates && adduser -D -H -u 10001 replicator
COPY --from=build /out/replicator /replicator
USER replicator
ENTRYPOINT ["/replicator"]
CMD ["daily", "-source", "CONTRATOS_GOV_BR"]
