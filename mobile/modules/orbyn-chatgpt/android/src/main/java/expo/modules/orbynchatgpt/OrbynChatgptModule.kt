package expo.modules.orbynchatgpt

import expo.modules.kotlin.modules.Module
import expo.modules.kotlin.modules.ModuleDefinition
import expo.modules.kotlin.Promise
import java.util.UUID

class OrbynChatgptModule : Module() {
  private val keys = ChatgptExecutorKey()
  private val lock = Any()
  private var current: Pair<String, ChatgptLoopback>? = null
  override fun definition() = ModuleDefinition {
    Name("OrbynChatgpt")
    AsyncFunction("start") { id: String, state: String, timeoutMs: Int ->
      UUID.fromString(id)
      val listener = ChatgptLoopback()
      val previous = synchronized(lock) { val old = current; current = Pair(id, listener); old }
      previous?.second?.cancel()
      listener.start(state, timeoutMs)
    }
    AsyncFunction("wait") { id: String, promise: Promise ->
      val active = synchronized(lock) { current?.takeIf { it.first == id } }
      if (active == null) promise.reject("CHATGPT_ATTEMPT", "This ChatGPT sign-in attempt is not active.", null)
      else active.second.wait { result ->
        result.fold({ promise.resolve(it) }, { promise.reject("CHATGPT_CALLBACK", "ChatGPT sign-in did not complete.", null) })
      }
    }
    AsyncFunction("cancel") { id: String ->
      val active = synchronized(lock) {
        val matched = current?.takeIf { it.first == id }
        if (matched != null) current = null
        matched
      }
      active?.second?.cancel()
    }
    AsyncFunction("keyMetadata") { account: String -> keys.metadata(account) }
    AsyncFunction("signProof") { account: String, fingerprint: String, message: String -> keys.sign(account, fingerprint, message) }
    AsyncFunction("removeKey") { account: String -> keys.remove(account) }
    OnDestroy {
      val active = synchronized(lock) { val old = current; current = null; old }
      active?.second?.cancel()
    }
  }
}
