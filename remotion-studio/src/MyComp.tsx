import React from 'react';
import {AbsoluteFill, interpolate, useCurrentFrame, useVideoConfig} from 'remotion';

export const MyComp: React.FC = () => {
  const frame = useCurrentFrame();
  const {durationInFrames} = useVideoConfig();
  const progress = interpolate(frame, [0, durationInFrames], [0, 100], {
    extrapolateLeft: 'clamp',
    extrapolateRight: 'clamp',
  });

  return (
    <AbsoluteFill style={{background: 'linear-gradient(135deg,#0b0f14,#0a0e15)', color: '#e9eef5'}}>
      <div style={{display: 'flex', height: '100%', alignItems: 'center', justifyContent: 'center', gap: 16}}>
        {[0, 1, 2].map((i) => {
          const y = interpolate(frame + i * 5, [0, 30, 60], [0, -40, 0], {
            extrapolateLeft: 'clamp',
            extrapolateRight: 'clamp',
          });
          return (
            <div
              key={i}
              style={{
                width: 80,
                height: 80,
                borderRadius: 16,
                background: i === 1 ? '#a07bff' : '#6ea8fe',
                transform: `translateY(${y}px)`,
              }}
            />
          );
        })}
      </div>

      {/* Progress bar */}
      <div
        style={{
          position: 'absolute',
          left: 20,
          right: 20,
          bottom: 30,
          height: 12,
          border: '1px solid rgba(255,255,255,0.3)',
          borderRadius: 8,
        }}
      >
        <div
          style={{
            height: '100%',
            width: `${progress}%`,
            background: '#6ea8fe',
            borderRadius: 8,
          }}
        />
      </div>
    </AbsoluteFill>
  );
};

