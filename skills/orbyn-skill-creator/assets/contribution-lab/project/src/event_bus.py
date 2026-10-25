"""A small subscription registry used only by the disposable evaluation lab."""


class EventBus:
    def __init__(self):
        self._topics = {}

    def subscribe(self, topic, key, callback):
        self._topics.setdefault(topic, []).append((key, callback))

        def dispose():
            self._topics[topic] = [
                row for row in self._topics.get(topic, []) if row[0] != key
            ]

        return dispose

    def emit(self, topic, value):
        for _, callback in tuple(self._topics.get(topic, [])):
            callback(value)
