package expo.modules.orbynchatgpt

import java.net.URI
import java.net.Socket
import java.util.concurrent.CountDownLatch
import java.util.concurrent.TimeUnit

fun main() {
  val state = "a".repeat(43)
  val listener = ChatgptLoopback()
  val callback = listener.start(state, 5000)
  val uri = URI(callback)
  fun request(query: String, origin: Boolean = false): Int {
    Socket("127.0.0.1", uri.port).use { socket ->
      socket.soTimeout = 2000
      val headers = if (origin) "Origin: https://untrusted.example\r\n" else ""
      socket.getOutputStream().write(("GET /auth/callback$query HTTP/1.1\r\nHost: 127.0.0.1:${uri.port}\r\n${headers}Connection: close\r\n\r\n").toByteArray())
      return socket.getInputStream().bufferedReader().readLine().split(" ")[1].toInt()
    }
  }
  check(request("?state=wrong&code=secret&client_id=oaiapp_fixture") == 400)
  check(request("?state=$state&state=$state&code=secret") == 400)
  check(request("?state=$state&code=secret", true) == 403)
  val done = CountDownLatch(1)
  var received = ""
  listener.wait { value -> received = value.getOrThrow(); done.countDown() }
  check(request("?state=$state&code=secret&client_id=oaiapp_fixture") == 200)
  check(done.await(2, TimeUnit.SECONDS))
  check(received == "$callback?state=$state&code=secret&client_id=oaiapp_fixture")
  val replay = CountDownLatch(1)
  listener.wait { check(it.isFailure); replay.countDown() }
  check(replay.await(2, TimeUnit.SECONDS))
  val cancelled = ChatgptLoopback()
  cancelled.start(state, 5000)
  val cancelDone = CountDownLatch(1)
  cancelled.wait { check(it.isFailure); cancelDone.countDown() }
  cancelled.cancel()
  check(cancelDone.await(2, TimeUnit.SECONDS))
  val timedOut = ChatgptLoopback()
  timedOut.start(state, 30)
  val timeoutDone = CountDownLatch(1)
  timedOut.wait { check(it.isFailure); timeoutDone.countDown() }
  check(timeoutDone.await(2, TimeUnit.SECONDS))
  println("PASS: wrong state, duplicate parameters, Origin, successful callback, replay, cancellation, timeout")
}
