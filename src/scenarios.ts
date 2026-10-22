export const scenarios = [
  {
    "id": "cafe-order",
    "emoji": "☕",
    "place": "카페",
    "situation": "음료 주문",
    "title": "카페에서 주문하기",
    "partner": "바리스타"
  },
  {
    "id": "restaurant-order",
    "emoji": "🍽️",
    "place": "레스토랑",
    "situation": "메뉴 추천받기·주문",
    "title": "레스토랑에서 식사 주문하기",
    "partner": "직원"
  },
  {
    "id": "clothes-shopping",
    "emoji": "🛍️",
    "place": "옷가게",
    "situation": "사이즈·색상 문의 / 피팅",
    "title": "옷가게에서 쇼핑하기",
    "partner": "직원"
  },
  {
    "id": "subway-route",
    "emoji": "🚉",
    "place": "지하철역",
    "situation": "노선·환승 방법 묻기",
    "title": "대중교통 이용하기",
    "partner": "역무원"
  },
  {
    "id": "street-directions",
    "emoji": "🗺️",
    "place": "길거리",
    "situation": "목적지 위치·방향 묻기",
    "title": "길을 물어보기",
    "partner": "행인"
  },
  {
    "id": "hotel-checkin",
    "emoji": "🏨",
    "place": "호텔",
    "situation": "체크인·시설 문의",
    "title": "호텔 체크인하기",
    "partner": "직원"
  },
  {
    "id": "market-shopping",
    "emoji": "🏪",
    "place": "편의점 / 마트",
    "situation": "상품 찾기·계산",
    "title": "마트에서 물건 구매하기",
    "partner": "직원"
  },
  {
    "id": "pharmacy-visit",
    "emoji": "💊",
    "place": "약국",
    "situation": "증상 설명·약 추천받기",
    "title": "약국에서 필요한 약 찾기",
    "partner": "약사"
  },
  {
    "id": "phone-reservation",
    "emoji": "📞",
    "place": "일상 / 전화",
    "situation": "예약 날짜·시간 정하기",
    "title": "전화로 예약하기",
    "partner": "예약 담당자"
  },
  {
    "id": "infra-interview",
    "emoji": "💻",
    "place": "IT 회사",
    "situation": "인프라 직무 면접",
    "title": "인프라 엔지니어 면접 보기",
    "partner": "면접관"
  }
] as const;
export type Scenario = typeof scenarios[number];
