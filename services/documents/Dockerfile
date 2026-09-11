# Byggs från REPO-ROTEN (docker-compose.yml sätter context: . för denna
# tjänst), inte från services/documents/. Hela monorepo-layouten speglas in
# i imagen (packages/contracts/schemas på samma relativa plats som lokalt)
# så documents/src/documents/contracts.py hittar schemafilerna med samma
# relativa sökväg oavsett om koden körs lokalt eller i containern — se
# kommentaren i contracts.py.

FROM python:3.13-slim
WORKDIR /app

# WeasyPrint renderar via Pango/Cairo — de här native-biblioteken måste
# finnas i imagen (Python-wheelen laddar dem i runtime via ctypes).
# fonts-dejavu-core ger ett förutsägbart typsnitt oavsett host.
RUN apt-get update && apt-get install -y --no-install-recommends \
      libpango-1.0-0 \
      libpangocairo-1.0-0 \
      libcairo2 \
      libgdk-pixbuf-2.0-0 \
      libffi8 \
      shared-mime-info \
      fonts-dejavu-core \
 && rm -rf /var/lib/apt/lists/*

RUN pip install --no-cache-dir uv

COPY services/documents/pyproject.toml services/documents/uv.lock services/documents/README.md services/documents/
# --no-install-project: bygger/installerar bara BEROENDENA i det här steget
# (cachebart så länge pyproject.toml/uv.lock inte ändras). Paketet
# "documents" självt kräver src/ för att gå att bygga, och den kopieras in
# efter — den sista uv sync nedan är snabb eftersom alla beroenden redan
# finns i .venv.
RUN cd services/documents && uv sync --frozen --no-dev --no-install-project

COPY packages/contracts/schemas packages/contracts/schemas
COPY services/documents services/documents

WORKDIR /app/services/documents
RUN uv sync --frozen --no-dev

# Bara till dokumentation/introspektion — faktisk port styrs av PORT/CMD.
EXPOSE 4004

CMD ["uv", "run", "uvicorn", "documents.main:app", "--host", "0.0.0.0", "--port", "4004"]
