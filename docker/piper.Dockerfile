# syntax=docker/dockerfile:1

# ARCHIVE-9's voice: Piper, running locally, with a French voice, behind a small HTTP API.
FROM python:3.12-slim
ARG PIPER_VERSION=1.3.0
ARG VOICE=fr_FR-upmc-medium
RUN pip install --no-cache-dir "piper-tts[http]==${PIPER_VERSION}"
WORKDIR /voices
RUN python3 -m piper.download_voices --data-dir /voices "${VOICE}"
ENV VOICE=${VOICE}
RUN useradd --system --no-create-home piper
USER piper
EXPOSE 5000
CMD ["sh", "-c", "exec python3 -m piper.http_server --data-dir /voices -m \"$VOICE\" --host 0.0.0.0 --port 5000"]
