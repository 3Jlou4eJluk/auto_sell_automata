.PHONY: backend frontend test build

backend:            ## API на :8000
	cd backend && uv run uvicorn app.main:app --reload --port 8000

frontend:           ## Vite dev на :5173 (проксирует /api на :8000)
	cd frontend && npm run dev

test:               ## тесты бэкенда
	cd backend && uv run pytest -q

build:              ## production-сборка фронтенда
	cd frontend && npm run build
