"""Alembic environment — async, driven by the app's settings + models metadata."""

import asyncio
from logging.config import fileConfig

from alembic import context
from sqlalchemy import pool
from sqlalchemy.engine import Connection
from sqlalchemy.ext.asyncio import async_engine_from_config

from config.settings import settings
from utils.database import Base

# Import all model modules so their tables register on Base.metadata.
import models.auth_models         # noqa: F401
import models.asm_models          # noqa: F401
import models.asset_models        # noqa: F401
import models.billing_model       # noqa: F401
import models.marketing_models    # noqa: F401
import models.tenancy_models      # noqa: F401
import models.notification_models # noqa: F401  # was missing → autogenerate would DROP notifications
import models.report_models       # noqa: F401  # was missing → autogenerate would DROP reports
import models.task_models         # noqa: F401  # was missing → autogenerate would DROP tasks
import models.vs_models           # noqa: F401  # VS (vulnerability scanning) tables
import models.ca_models           # noqa: F401  # CA (compliance & audit) tables

config = context.config
config.set_main_option("sqlalchemy.url", settings.DATABASE_URL)

if config.config_file_name is not None:
    fileConfig(config.config_file_name)

target_metadata = Base.metadata


def do_run_migrations(connection: Connection) -> None:
    context.configure(
        connection=connection,
        target_metadata=target_metadata,
        compare_type=True,
        compare_server_default=True,
    )
    with context.begin_transaction():
        context.run_migrations()


async def run_async_migrations() -> None:
    connectable = async_engine_from_config(
        config.get_section(config.config_ini_section, {}),
        prefix="sqlalchemy.",
        poolclass=pool.NullPool,
    )
    async with connectable.connect() as connection:
        await connection.run_sync(do_run_migrations)
    await connectable.dispose()


def run_migrations_offline() -> None:
    context.configure(
        url=settings.DATABASE_URL,
        target_metadata=target_metadata,
        literal_binds=True,
        dialect_opts={"paramstyle": "named"},
    )
    with context.begin_transaction():
        context.run_migrations()


if context.is_offline_mode():
    run_migrations_offline()
else:
    asyncio.run(run_async_migrations())
