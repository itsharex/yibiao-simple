FROM python:3.11-slim-bookworm

ENV PYTHONUNBUFFERED=1 \
    PIP_NO_CACHE_DIR=1 \
    DOC2MD_MAX_WORKERS=4 \
    DOC2MD_MAX_QUEUE_SIZE=8

RUN sed -i 's|http://deb.debian.org/debian|https://mirrors.tuna.tsinghua.edu.cn/debian|g; s|http://deb.debian.org/debian-security|https://mirrors.tuna.tsinghua.edu.cn/debian-security|g' /etc/apt/sources.list.d/debian.sources

RUN bash -lc 'success=0; for i in 1 2 3; do if apt-get -o Acquire::Retries=5 update && apt-get -o Acquire::Retries=5 install -y --fix-missing --no-install-recommends \
    libreoffice \
    libreoffice-writer \
    fonts-noto-cjk \
    fonts-dejavu \
    libgl1 \
    libglib2.0-0 \
    curl \
    procps; then success=1; break; fi; sleep 5; done; test "$success" = 1 && rm -rf /var/lib/apt/lists/*'

WORKDIR /app

COPY requirements.txt ./requirements.txt
RUN pip install -r requirements.txt

COPY app ./app
COPY tests ./tests

EXPOSE 8000

HEALTHCHECK --interval=30s --timeout=10s --start-period=20s --retries=3 \
  CMD curl -f http://127.0.0.1:8000/openapi.json || exit 1

CMD ["uvicorn", "app.main:app", "--host", "0.0.0.0", "--port", "8000"]
