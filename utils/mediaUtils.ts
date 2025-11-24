
export const generateVideoThumbnail = (file: File): Promise<string> => {
    return new Promise((resolve) => {
        const video = document.createElement('video');
        video.preload = 'metadata';
        video.src = URL.createObjectURL(file);
        video.muted = true;
        video.playsInline = true;
        
        // Wait for metadata to load to get duration/dimensions
        video.onloadedmetadata = () => {
            // Seek to 1 second or 25% to get a good frame, not black screen
            video.currentTime = Math.min(1.0, video.duration * 0.25);
        };

        video.onseeked = () => {
            const canvas = document.createElement('canvas');
            canvas.width = 320; // Thumbnail width
            canvas.height = 180; // 16:9 Aspect
            
            const ctx = canvas.getContext('2d');
            if (ctx) {
                ctx.drawImage(video, 0, 0, canvas.width, canvas.height);
                const dataUrl = canvas.toDataURL('image/jpeg', 0.7);
                URL.revokeObjectURL(video.src);
                resolve(dataUrl);
            } else {
                resolve('');
            }
        };

        video.onerror = () => {
            resolve('');
        };
    });
};
