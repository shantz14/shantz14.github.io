# Build on the host's native platform and cross-compile for the target, so multi-arch builds need no QEMU.
FROM --platform=$BUILDPLATFORM golang:1.27-alpine AS build
ARG TARGETOS TARGETARCH
WORKDIR /src
COPY server/go.mod server/go.sum ./
RUN go mod download
COPY server/ ./
RUN CGO_ENABLED=0 GOOS=$TARGETOS GOARCH=$TARGETARCH go build -trimpath -ldflags="-s -w" -o /server .

FROM gcr.io/distroless/static-debian12:nonroot
COPY --from=build /server /server
COPY index.html styles.css comments.css comments.js palette.css palette.js notes.css lorenz.js graph.js resume.pdf /site/
# Only notes tagged `public` ever reach garden/ (see garden.sh).
COPY garden/ /site/garden/
# The SQLite database lives here; mount a volume so comments survive restarts.
COPY --from=build --chown=nonroot:nonroot /tmp /data
VOLUME /data
ENV STATIC_DIR=/site GARDEN_DIR=/site/garden DB_PATH=/data/comments.db ADDR=:8080
EXPOSE 8080
ENTRYPOINT ["/server"]
