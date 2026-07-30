package com.mora.service;

import org.springframework.beans.factory.annotation.Value;
import org.springframework.core.io.ByteArrayResource;
import org.springframework.http.*;
import org.springframework.stereotype.Service;
import org.springframework.util.LinkedMultiValueMap;
import org.springframework.util.MultiValueMap;
import org.springframework.web.client.RestTemplate;
import org.springframework.web.multipart.MultipartFile;

import java.util.Map;

/**
 * ═══════════════════════════════════════════════════════════════
 * OcrService — 외부 OCR(문자 인식) 서비스 호출 서비스
 * ═══════════════════════════════════════════════════════════════
 *
 * [역할]
 * 클라이언트가 업로드한 명함 이미지를 외부 Python OCR 서버
 * (PaddleOCR 기반)에 전달하여 문자 인식 결과를 받아오는 서비스이다.
 * CardController에서 /api/scan 엔드포인트 처리 시 호출된다.
 *
 * [코드 흐름]
 * 1) CardController.scan()에서 MultipartFile(업로드된 이미지)과 함께 호출된다.
 * 2) MultipartFile을 ByteArrayResource로 변환한다 (RestTemplate 전송 가능 형태).
 * 3) multipart/form-data 요청을 구성한다 ("file" 파트에 이미지 첨부).
 * 4) RestTemplate.exchange()로 Python OCR 서버의 /api/scan 엔드포인트에 POST 요청.
 * 5) OCR 서버가 반환한 JSON 결과(이름, 회사, 직책, 전화번호 등)를 Map으로 반환한다.
 *
 * [메서드 목록]
 * - scan(MultipartFile file): 이미지를 OCR 서버에 보내고 인식 결과를 Map으로 반환한다.
 * - createFileHeaders(MultipartFile): 파일 파트의 Content-Type 헤더를 생성한다.
 *
 * [사용된 어노테이션/라이브러리]
 * ───────────────────────────────────────────
 * @Service
 *   — 서비스 계층 빈 선언.
 *
 * @Value("${app.ocr-service-url}")
 *   — application.yml에서 OCR 서비스의 기본 URL을 주입한다.
 *     예: "http://localhost:8000"
 *
 * @SuppressWarnings("unchecked")
 *   — 제네릭 타입 캐스팅 경고 억제.
 *
 * [MultipartFile (Spring Web)]
 * ───────────────────────────────────────────
 * MultipartFile
 *   — 클라이언트가 업로드한 파일을 나타내는 인터페이스.
 *     getBytes()로 파일 내용을, getOriginalFilename()으로 원본 파일명을 얻는다.
 *
 * [ByteArrayResource (Spring Core)]
 * ───────────────────────────────────────────
 * ByteArrayResource
 *   — 바이트 배열을 Resource로 감싸는 클래스.
 *     getFilename()을 오버라이드하여 파일명을 지정해야
 *     RestTemplate이 multipart 파일 파트로 올바르게 전송한다.
 *
 * [RestTemplate (Spring Web)]
 * ───────────────────────────────────────────
 * restTemplate.exchange()
 *   — HTTP 요청을 보내고 응답을 받는다. multipart/form-data 전송에 사용.
 *
 * [LinkedMultiValueMap (Spring Util)]
 * ───────────────────────────────────────────
 * LinkedMultiValueMap<String, Object>
 *   — multipart 요청의 각 파트를 key-value로 담는 맵.
 *     "file" 키에 HttpEntity<Resource>를 추가하여 파일 파트를 구성한다.
 * ───────────────────────────────────────────
 */
@Service
public class OcrService {

    private final RestTemplate restTemplate;

    @Value("${app.ocr-service-url}")
    private String ocrServiceUrl;

    public OcrService(RestTemplate restTemplate) {
        this.restTemplate = restTemplate;
    }

    /**
     * 명함 이미지를 외부 OCR 서버에 전송하고 인식 결과를 반환한다.
     *
     * @param file 클라이언트가 업로드한 명함 이미지 파일
     * @return OCR 인식 결과 (이름, 회사, 직책, 전화번호, 이메일, 원본 텍스트 등)
     * @throws RuntimeException OCR 서비스 호출 실패 시
     */
    @SuppressWarnings("unchecked")
    public Map<String, Object> scan(MultipartFile file) {
        try {
            // 외부 OCR 서버로 보낼 HTTP 헤더 설정 (multipart/form-data)
            HttpHeaders headers = new HttpHeaders();
            headers.setContentType(MediaType.MULTIPART_FORM_DATA);

            // MultipartFile → ByteArrayResource 변환 (RestTemplate이 전송할 수 있는 형태)
            // getFilename()을 오버라이드해야 파일명이 multipart 파트에 포함된다
            ByteArrayResource resource = new ByteArrayResource(file.getBytes()) {
                @Override
                public String getFilename() {
                    return file.getOriginalFilename();
                }
            };

            // multipart 요청 바디 구성: "file" 파트에 이미지 파일 추가
            MultiValueMap<String, Object> body = new LinkedMultiValueMap<>();
            body.add("file", new HttpEntity<>(resource, createFileHeaders(file)));

            HttpEntity<MultiValueMap<String, Object>> requestEntity = new HttpEntity<>(body, headers);

            // Python OCR 서버의 /api/scan 엔드포인트에 POST 요청
            ResponseEntity<Map> response = restTemplate.exchange(
                    ocrServiceUrl + "/api/scan",
                    HttpMethod.POST,
                    requestEntity,
                    Map.class
            );

            return response.getBody();
        } catch (Exception e) {
            throw new RuntimeException("OCR service call failed: " + e.getMessage(), e);
        }
    }

    /**
     * 파일 파트의 Content-Type 헤더를 생성한다.
     * MultipartFile의 contentType이 null이면 application/octet-stream을 사용한다.
     */
    private HttpHeaders createFileHeaders(MultipartFile file) {
        HttpHeaders headers = new HttpHeaders();
        headers.setContentType(MediaType.parseMediaType(
                file.getContentType() != null ? file.getContentType() : "application/octet-stream"));
        return headers;
    }
}
