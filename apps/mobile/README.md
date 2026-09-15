# Michikusa Mobile Sync

iPhone 사진 보관함을 직접 읽고, 선택한 기간의 사진을 **기기 안에서 Apple Vision으로 분류**한 뒤 POI 후보만 같은 Wi-Fi의 Michikusa PC 서버로 보내는 companion 앱입니다.

## 현재 MVP

- 시작일/종료일 기간 필터
- 기간 내 사진 수 확인
- iOS 사진 보관함 전체 접근
- Apple Vision `VNClassifyImageRequest` 온디바이스 분류
- POI 후보: food / restaurant / landmark / accommodation / transit / nature / street
- 스크린샷 자동 제외
- POI 후보만 최대 1600px JPEG로 축소 후 PC에 HTTP multipart 전송
- PC 서버에서 WebP로 저장
- iOS asset ID 기반 중복 방지
- 촬영 시각/GPS/category를 기존 Photo 테이블에 저장

사진 원본 전체를 먼저 PC로 옮기지 않습니다. 분석과 필터링은 iPhone에서 하고, 남긴 후보 이미지만 LAN으로 전송합니다.

## 중요한 점: Expo Go와 development build

사진 보관함 UI와 기간 확인은 Expo Go에서도 확인할 수 있지만, Apple Vision 분류기는 이 앱의 Swift inline native module입니다. 따라서 **실제 POI 분석에는 development build가 필요합니다.**

Expo는 custom native code를 Expo Go에 동적으로 추가할 수 없기 때문에 이 부분은 우회할 수 없습니다.

### Windows + iPhone에서 development build

처음 한 번:

```bash
git pull
pnpm install

cd apps/mobile
pnpm dlx eas-cli login
pnpm dlx eas-cli build --profile development --platform ios
```

EAS가 Expo 프로젝트 연결이나 Apple signing 설정을 물어보면 안내에 따라 진행합니다. 빌드가 끝나면 iPhone에 development build를 설치합니다.

그 다음부터 JS/TS만 바꾼 경우에는 앱을 다시 빌드하지 않고 루트에서:

```bash
pnpm mobile
```

을 실행하고 development build에서 Metro 서버에 연결하면 됩니다. `MichikusaVisionModule.swift`를 바꾼 경우에만 native development build를 다시 만들어야 합니다.

## PC 연결 테스트

1. PC와 iPhone을 같은 Wi-Fi에 연결합니다.
2. PC에서 Michikusa 서버를 실행합니다.
3. Windows에서 `ipconfig`를 실행하고 현재 Wi-Fi/Ethernet의 IPv4 주소를 확인합니다.
4. 예를 들어 PC가 `192.168.0.15`라면 iPhone 앱의 PC 서버 주소에 다음을 입력합니다.

```text
http://192.168.0.15:4000
```

5. iPhone Safari에서 먼저 아래 주소를 열어보면 LAN 연결을 빠르게 확인할 수 있습니다.

```text
http://192.168.0.15:4000/health
```

안 열리면 Windows 방화벽에서 Node.js의 **Private network** 접근을 허용했는지 확인합니다.

서버는 LAN 수신을 위해 `0.0.0.0:4000`에 listen합니다. 인터넷이나 별도 클라우드 업로드 서버는 사용하지 않습니다.

## 첫 실기 테스트

63,000장을 바로 돌리지 말고 먼저 1~3일 정도로 검증합니다.

1. 기간을 1~3일로 지정
2. **기간 사진 수 확인**
3. **POI 후보 분석 시작**
4. 후보 수와 상위 label 확인
5. PC 서버 주소 입력
6. **후보 N장 전송**
7. Michikusa 웹을 새로고침해서 timeline/지도 후보 확인

처음에 볼 지표는 두 가지입니다.

- Vision 필터가 실제 POI 사진을 얼마나 놓치는가
- POI가 아닌 사진이 얼마나 많이 섞이는가

이 결과가 별로면 `src/photos/photo-scan.ts`의 threshold/label rule을 조정하거나, 이후 SigLIP/Core ML 모델로 교체하면 됩니다.
