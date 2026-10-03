"""Award closed Hall of Fame periods without blocking ranking requests."""

import asyncio
from datetime import datetime, timedelta
import logging

logger = logging.getLogger(__name__)


class CrownSchedule:
    def __init__(self):
        self.completed_day = None
        self.next_check = None

    def tick(self, session_factory, award, now=None):
        now = now or datetime.now()
        day = now.date()
        if self.completed_day == day and self.next_check and now < self.next_check:
            return 0
        with session_factory() as db:
            count = award(db)
            # Empty periods still advance the category progress records.
            db.commit()
        # Only successful sweeps advance the checkpoint. A locked database or
        # transient failure is retried instead of losing the entire day's run.
        self.completed_day = day
        # All-time champion changes also need to be noticed during the day.
        self.next_check = now + timedelta(minutes=5)
        return count


async def run():
    from database import SessionLocal
    from services.crowns import award_due_crowns

    schedule = CrownSchedule()
    while True:
        try:
            count = await asyncio.to_thread(schedule.tick, SessionLocal, award_due_crowns)
            if count:
                logger.info("Awarded %s Hall of Fame crowns", count)
        except Exception:
            logger.exception("Hall of Fame award check failed; retrying in one minute")
        await asyncio.sleep(60)
