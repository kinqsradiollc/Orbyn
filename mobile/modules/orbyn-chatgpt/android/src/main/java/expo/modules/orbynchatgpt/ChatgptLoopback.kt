package expo.modules.orbynchatgpt

import java.net.InetAddress
import java.net.ServerSocket
import java.net.Socket
import java.net.URI
import java.net.URLDecoder
import java.security.MessageDigest
import java.util.concurrent.Executors
import java.util.concurrent.TimeUnit

/** One device-local callback; credentials and authorization codes are never persisted or logged. */
internal class ChatgptLoopback {
  private val lock = Any()
  private val worker = Executors.newSingleThreadScheduledExecutor()
  private var server: ServerSocket? = null
  private var active: Socket? = null
  private var state = ""
  private var result: Result<String>? = null
  private var waiter: ((Result<String>) -> Unit)? = null
  private var finished = false
  private var delivered = false
  private fun failure() = IllegalStateException("ChatGPT sign-in did not complete.")

  fun start(state: String, timeoutMs: Int): String {
    require(Regex("^[A-Za-z0-9_-]{43}$").matches(state) && timeoutMs in 1..600000)
    val socket = ServerSocket(0, 8, InetAddress.getByName("127.0.0.1"))
    synchronized(lock) {
      if (server != null || finished) { socket.close(); throw failure() }
      this.state = state
      server = socket
    }
    // A separate deadline must be able to close a blocked accept/read.
    val deadline = Executors.newSingleThreadScheduledExecutor()
    deadline.schedule({ cancel(); deadline.shutdown() }, timeoutMs.toLong(), TimeUnit.MILLISECONDS)
    val callback = "http://127.0.0.1:${socket.localPort}/auth/callback"
    worker.execute {
      try {
        while (!socket.isClosed) {
          val connection = socket.accept()
          synchronized(lock) {
            if (finished) { connection.close(); return@execute }
            active = connection
          }
          try {
            connection.soTimeout = 3000
            if (!connection.inetAddress.isLoopbackAddress) continue
            val url = readCallback(connection, callback)
            if (url != null) {
              respond(connection, 200, "Sign-in received. Return to Orbyn.")
              finish(Result.success(url))
              return@execute
            }
          } catch (_: Exception) {
            // Invalid/slow local connections cannot consume the authorization attempt.
          } finally {
            synchronized(lock) { if (active === connection) active = null }
            connection.close()
          }
        }
      } catch (_: Exception) { finish(Result.failure(failure())) }
      finally { deadline.shutdownNow(); worker.shutdown() }
    }
    return callback
  }

  fun wait(callback: (Result<String>) -> Unit) {
    val immediate = synchronized(lock) {
      if (delivered || waiter != null) Result.failure(failure())
      else if (result != null) { delivered = true; val value = result; result = null; value }
      else { waiter = callback; null }
    }
    immediate?.let(callback)
  }

  fun cancel() { finish(Result.failure(failure())) }

  private fun finish(value: Result<String>) {
    val receive = synchronized(lock) {
      if (finished) return
      finished = true
      runCatching { server?.close() }
      runCatching { active?.close() }
      server = null
      active = null
      state = ""
      val receive = waiter
      waiter = null
      if (receive != null) delivered = true else result = value
      receive
    }
    receive?.invoke(value)
    worker.shutdown()
  }

  private fun readCallback(connection: Socket, callback: String): String? {
    val bytes = ArrayList<Byte>()
    val input = connection.getInputStream()
    while (bytes.size <= 8192) {
      val value = input.read()
      if (value < 0) return null
      bytes.add(value.toByte())
      if (bytes.size >= 4 && bytes.takeLast(4) == listOf(13.toByte(), 10.toByte(), 13.toByte(), 10.toByte())) break
    }
    if (bytes.size > 8192) { respond(connection, 400); return null }
    val text = bytes.toByteArray().toString(Charsets.UTF_8)
    val lines = text.split("\r\n")
    val request = lines[0].split(" ")
    if (request.size != 3 || request[0] != "GET" || request[2] != "HTTP/1.1" ||
      !request[1].startsWith("/") || request[1].startsWith("//")) {
      respond(connection, 400); return null
    }
    val parsed = URI(callback).resolve(request[1])
    if (parsed.rawPath != "/auth/callback" || parsed.fragment != null) { respond(connection, 400); return null }
    val headers = mutableMapOf<String, String>()
    for (line in lines.drop(1)) {
      if (line.isEmpty()) break
      val parts = line.split(":", limit = 2)
      if (parts.size != 2 || headers.put(parts[0].lowercase(), parts[1].trim()) != null) {
        respond(connection, 400); return null
      }
    }
    if (headers["host"] != URI(callback).rawAuthority || headers.containsKey("origin") ||
      headers.containsKey("transfer-encoding") || (headers["content-length"] != null && headers["content-length"] != "0")) {
      respond(connection, 403); return null
    }
    val params = mutableMapOf<String, String>()
    for (item in (parsed.rawQuery ?: "").split("&")) {
      val pair = item.split("=", limit = 2)
      val name = URLDecoder.decode(pair[0], "UTF-8")
      val value = if (pair.size == 2) URLDecoder.decode(pair[1], "UTF-8") else ""
      if (params.put(name, value) != null) { respond(connection, 400); return null }
    }
    if (!MessageDigest.isEqual((params["state"] ?: "").toByteArray(), state.toByteArray())) {
      respond(connection, 400); return null
    }
    return parsed.toString()
  }

  private fun respond(connection: Socket, status: Int, message: String = "Invalid ChatGPT callback.") {
    val response = "HTTP/1.1 $status ${if (status == 200) "OK" else "Rejected"}\r\n" +
      "Content-Type: text/plain; charset=utf-8\r\nContent-Length: ${message.toByteArray().size}\r\n" +
      "Cache-Control: no-store\r\nContent-Security-Policy: default-src 'none'; frame-ancestors 'none'\r\n" +
      "Referrer-Policy: no-referrer\r\nX-Content-Type-Options: nosniff\r\nConnection: close\r\n\r\n$message"
    connection.getOutputStream().write(response.toByteArray(Charsets.UTF_8))
    connection.getOutputStream().flush()
  }
}
