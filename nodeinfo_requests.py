"""Bounded, nonblocking discovery of unknown text-message senders."""
from collections import OrderedDict
from threading import Lock, Timer
from time import monotonic


class DelayedNodeInfoRequests:
    def __init__(self, delay=5, cooldown=600, capacity=256, timer_factory=Timer, clock=monotonic):
        self.delay = delay
        self.cooldown = cooldown
        self.capacity = capacity
        self.timer_factory = timer_factory
        self.clock = clock
        self.lock = Lock()
        self.pending = set()
        self.recent = OrderedDict()
        self.next_slot = 0

    def schedule(self, sender, callback):
        with self.lock:
            now = self.clock()
            while self.recent and next(iter(self.recent.values())) <= now - self.cooldown:
                self.recent.popitem(last=False)
            if sender in self.pending or sender in self.recent or len(self.pending) >= self.capacity:
                return False
            self.pending.add(sender)
            # Stagger different senders rather than transmitting a burst at once.
            due = max(now + self.delay, self.next_slot)
            self.next_slot = due + 1

        def run():
            try:
                callback()
            finally:
                with self.lock:
                    self.pending.discard(sender)
                    self.recent[sender] = self.clock()
                    self.recent.move_to_end(sender)
                    while len(self.recent) > self.capacity:
                        self.recent.popitem(last=False)

        timer = self.timer_factory(due - now, run)
        timer.daemon = True
        try:
            timer.start()
        except Exception:
            with self.lock:
                self.pending.discard(sender)
            raise
        return True
