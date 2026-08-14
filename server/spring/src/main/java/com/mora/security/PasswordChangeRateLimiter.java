package com.mora.security;

import org.springframework.stereotype.Component;

import java.util.concurrent.ConcurrentHashMap;
import java.util.concurrent.atomic.AtomicInteger;

// 분당 5회, 키=IP:토큰뒤8자. 인메모리라 재시작하면 초기화됨
@Component
public class PasswordChangeRateLimiter {

    private static final int MAX_PER_MINUTE = 5;
    private static final long WINDOW_MS = 60_000;

    private static final class Bucket {
        final AtomicInteger count = new AtomicInteger(0);
        volatile long windowStart;

        Bucket(long windowStart) {
            this.windowStart = windowStart;
        }
    }

    private final ConcurrentHashMap<String, Bucket> buckets = new ConcurrentHashMap<>();

    public boolean tryConsume(String key) {
        long now = System.currentTimeMillis();
        Bucket bucket = buckets.compute(key, (k, existing) -> {
            if (existing == null || now - existing.windowStart >= WINDOW_MS) {
                return new Bucket(now);
            }
            return existing;
        });
        return bucket.count.incrementAndGet() <= MAX_PER_MINUTE;
    }

    public static String resolveKey(String ip, String token) {
        String suffix = token.length() >= 8 ? token.substring(token.length() - 8) : token;
        return ip + ":" + suffix;
    }
}
