import unittest

from src.event_bus import EventBus


class BasicEvents(unittest.TestCase):
    def test_single_delivery_and_disposal(self):
        bus = EventBus()
        seen = []
        dispose = bus.subscribe('news', 'owner', seen.append)
        bus.emit('news', 'first')
        dispose()
        bus.emit('news', 'second')
        self.assertEqual(seen, ['first'])

    def test_topic_isolation(self):
        bus = EventBus()
        seen = []
        bus.subscribe('news', 'owner', seen.append)
        bus.emit('other', 'ignored')
        self.assertEqual(seen, [])
