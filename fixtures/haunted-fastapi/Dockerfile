FROM python:3.12-slim
COPY . /srv
WORKDIR /srv
RUN pip install .
CMD ["uvicorn", "app.main:app", "--host", "0.0.0.0", "--port", "8000"]
