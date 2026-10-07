# Baseball Web Prototype

Unity 없이 **GitHub + Google Colab + Three.js**로 실행하는 3D 야구 프로토타입입니다.

## 현재 1차 프로토타입
- FBX 구장 로드
- 같은 선수 모델로 투수/타자 배치
- 투수/타자 애니메이션
- 배트와 글러브 장착
- 야구공 투구
- Space 스윙
- 타이밍이 맞으면 타구 생성 + 중력/바운드
- localhost / Cloudflare / ngrok 사용 안 함

## GitHub에 올리기
이 폴더 전체를 하나의 저장소에 넣으세요.
`BaseballPlayer.fbx`가 25MB를 넘기 때문에 GitHub 웹 업로드는 제한될 수 있습니다.
그 경우 PC Git 또는 Colab에서 git push를 사용하세요. GitHub의 단일 파일 하드 제한(100MB)보다 작은 파일입니다.

## Colab
`Baseball_Colab_Launcher.ipynb`를 열고 첫 줄의 `REPO_URL`만 자기 저장소 주소로 수정한 뒤 셀 하나를 실행합니다.

## 키
- P: 투구
- Space / S: 스윙
- R: 공 리셋
- 마우스 드래그: 카메라 회전
- 휠: 줌

첫 버전은 시스템 연결 확인용입니다. 다음 단계에서 PCI/구종/타구판정/수비/주루를 별도 모듈로 확장하면 됩니다.
