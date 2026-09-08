## Windows 개발용 launcher

`Michikusa.exe`는 완제품 패키지가 아니라 **로컬 개발 환경의 Node / pnpm / Python을 그대로 사용하는 launcher**다.

동작:

```text
Michikusa.exe
→ repo 루트에서 pnpm dev
→ Next.js :3000 + NestJS :4000
→ 둘 다 준비되면 http://localhost:3000 자동 오픈
→ launcher 종료 시 pnpm dev process tree 종료
```

브라우저 탭만 닫는 것은 앱 종료로 취급하지 않는다. launcher 콘솔 창을 닫거나 `Ctrl+C`를 눌러야 web/server가 함께 종료된다.

### 처음 한 번 준비

repo 루트에서:

```bash
pnpm install
pnpm launcher:build
```

완료되면 repo 루트에:

```text
Michikusa.exe
```

가 생성된다. 이후에는 이 파일을 더블클릭하면 된다.

`Michikusa.exe`는 생성물이라 Git에는 넣지 않는다.

### 실행 전 필요한 것

기존 개발 실행과 동일하다.

- Node 22+
- pnpm
- `pnpm install` 완료
- `apps/server/.env`
- `apps/web/.env.local`
- SigLIP2를 쓸 경우 `apps/server/.venv`

환경파일이 없으면 launcher가 warning을 출력한다. Google key 없이도 import / timeline / diagnostics 등 Google 비의존 기능은 실행할 수 있다.

### 종료

정상 종료 방법:

- launcher 콘솔의 `X`
- `Ctrl+C`

launcher는 자신이 시작한 `pnpm dev` PID에 대해 Windows `taskkill /T /F`를 호출해서 Next/Nest를 포함한 하위 process tree를 함께 종료한다.

강제 전원 종료나 launcher 자체를 Task Manager에서 즉시 강제 종료하는 경우까지 process cleanup을 보장하지는 않는다.

### 중복 실행 방지

시작 전에 다음 URL을 확인한다.

```text
http://localhost:3000
http://localhost:4000/health
```

둘 중 하나라도 이미 응답하면 기존 dev server가 있다고 보고 새 launcher는 시작하지 않는다. 기존 터미널의 `pnpm dev`를 먼저 종료한다.

### launcher 자체 디버깅

`.exe`를 만들기 전 source 상태로 실행:

```bash
pnpm launcher:dev
```

SEA 실행 파일이 repo를 찾는지만 확인:

```powershell
.\Michikusa.exe --check
```

### 자동 검증

`.github/workflows/launcher.yml`이 Windows runner에서:

1. launcher 의존성 설치
2. `pnpm launcher:build`
3. `Michikusa.exe --check`

를 수행한다. 실제 생성물은 각 개발 PC에서 한 번 빌드해 사용한다.
