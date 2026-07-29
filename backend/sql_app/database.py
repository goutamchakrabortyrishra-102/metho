import os
from sqlalchemy import create_engine
from sqlalchemy.orm import declarative_base, sessionmaker

# Use PostgreSQL/MySQL in production; fallback SQLite keeps local startup easy.
DATABASE_URL = os.getenv("DATABASE_URL", "sqlite:///./metho_sql.db")

engine = create_engine(DATABASE_URL, pool_pre_ping=True)
SessionLocal = sessionmaker(autocommit=False, autoflush=False, bind=engine)
Base = declarative_base()


def get_db():
    db = SessionLocal()
    try:
        yield db
    finally:
        db.close()
