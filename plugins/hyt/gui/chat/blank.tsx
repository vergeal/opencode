import type { Context } from "@aicraft/aix/gui"
import { Show } from "solid-js"
import type { Phase } from "./contract.js"
import { text } from "./i18n.js"

/**
 * 整页状态：加载、空态、错误。
 *
 * 三种都是同一套「左侧一道封红 + 标题 + 说明 + 动作」的排法，加载态额外画成三栏骨架，
 * 避免整页转圈把布局先撑起来又塌回去。阶段变化要能原地切换，所以用 Show 分支而不是提前 return。
 */
export function Blank(props: {
  ctx: Context
  phase: Phase
  detail: string
  /** 后台静默登录的失败原因；空串时不显示。 */
  authError: string
  /** 凭据来源：决定动作区显示「登录」还是「退出登录」。 */
  credential: "saved" | "client" | "missing"
  onRetry: () => void
  onSettings: () => void
  /** 打开登录页，用账号密码登录。 */
  onLogin: () => void
  /** 重新登录入口：已保存凭据不可用（例如被服务器强制下线）时清掉凭据回到登录页。 */
  onLogout?: () => void
}) {
  const title = () => {
    if (props.phase === "no-account") return text(props.ctx, "hyt.chat.state.title.no-account")
    if (props.phase === "no-data") return text(props.ctx, "hyt.chat.state.title.no-data")
    if (props.phase === "error") return text(props.ctx, "hyt.chat.state.title.error")
    return text(props.ctx, "hyt.chat.state.title.empty")
  }

  const body = () => {
    if (props.phase === "no-account") return text(props.ctx, "hyt.chat.state.body.no-account")
    if (props.phase === "no-data") return text(props.ctx, "hyt.chat.state.body.no-data")
    if (props.phase === "error") return text(props.ctx, "hyt.chat.state.body.error")
    return text(props.ctx, "hyt.chat.state.body.empty")
  }

  const detail = () => props.detail

  return (
    <Show
      when={props.phase !== "loading"}
      fallback={
        <div class="blank blank--frame">
          <div class="sk-rail">
            <div class="sk" style={{ height: "14px", width: "55%", "margin-bottom": "24px" }} />
            <div class="sk w80" />
            <div class="sk w60" />
            <div class="sk w80" />
            <div class="sk w40" />
            <div class="sk w80" />
            <div class="sk w60" />
          </div>
          <div class="sk-desk">
            <div class="sk" style={{ height: "34px", width: "260px", "margin-bottom": "28px" }} />
            <p class="sk-hint">{text(props.ctx, "hyt.chat.blank.loading")}</p>
            <div class="inner">
              <div class="sk tall w60" />
              <div class="sk w40" />
              <div class="sk tall w60" style={{ "margin-left": "auto" }} />
              <div class="sk tall w40" />
              <div class="sk w60" />
            </div>
          </div>
        </div>
      }
    >
      <div class="blank">
        <div class="blank-brand">{text(props.ctx, "hyt.chat.blank.brand")}</div>
        <div class="blank-inner">
          <h2 class="blank-title">{title()}</h2>
          <p class="blank-body">{body()}</p>
          <Show when={props.authError.length > 0}>
            <p class="login-error">{text(props.ctx, "hyt.chat.state.auth.failed", { message: props.authError })}</p>
          </Show>
          <div class="blank-actions">
            {/*
              没有已保存凭据时，「登录」就是主按钮：靠客户端 login.db 里的旧账号登录失败、
              或者刚装好还没登录，都从这里直接输入账号密码，不用先去找别处。
            */}
            <Show
              when={props.credential !== "saved"}
              fallback={
                <>
                  <button class="button" type="button" onClick={() => props.onRetry()}>
                    {text(props.ctx, props.phase === "error" ? "hyt.chat.action.retry" : "hyt.chat.action.detect")}
                  </button>
                  <button class="ghost" type="button" onClick={() => props.onLogin()}>
                    {text(props.ctx, "hyt.chat.rail.login")}
                  </button>
                  {/* 文件被占用的错误态只能稍后重试，打开设置解决不了问题，不给这个出口。 */}
                  <Show when={props.phase !== "error"}>
                    <button class="ghost" type="button" onClick={() => props.onSettings()}>
                      {text(props.ctx, "hyt.chat.action.settings")}
                    </button>
                  </Show>
                  <Show when={props.onLogout !== undefined}>
                    <button class="ghost" type="button" onClick={() => props.onLogout?.()}>
                      {text(props.ctx, "hyt.chat.rail.logout")}
                    </button>
                  </Show>
                </>
              }
            >
              <button class="button" type="button" onClick={() => props.onLogin()}>
                {text(props.ctx, "hyt.chat.rail.login")}
              </button>
              <button class="ghost" type="button" onClick={() => props.onRetry()}>
                {text(props.ctx, "hyt.chat.action.detect")}
              </button>
              <Show when={props.phase !== "error"}>
                <button class="ghost" type="button" onClick={() => props.onSettings()}>
                  {text(props.ctx, "hyt.chat.action.settings")}
                </button>
              </Show>
            </Show>
          </div>

          <Show when={props.phase === "error" && detail().length > 0}>
            <details class="tech">
              <summary>{text(props.ctx, "hyt.chat.error.tech")}</summary>
              <pre>{detail()}</pre>
            </details>
          </Show>

          <Show when={props.phase !== "error" && detail().length > 0}>
            <p class="panel-note">
              {text(props.ctx, "hyt.chat.state.detail")}：{detail()}
            </p>
          </Show>
        </div>
      </div>
    </Show>
  )
}
