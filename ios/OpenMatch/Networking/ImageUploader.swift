import Foundation
import UIKit

// Downscale + recompress a UIImage so a typical iPhone photo (~5-12MB
// original) becomes a ~0.5-1.5MB JPEG suitable for the backend's 4MB
// upload cap. The longest edge is clamped to `maxDimension` and the
// JPEG quality is iteratively lowered until the byte budget is met.
enum ImageUploader {
    static func compressForUpload(
        _ image: UIImage,
        maxDimension: CGFloat = 1600,
        targetBytes: Int = 1_500_000,
        minQuality: CGFloat = 0.45
    ) -> Data? {
        let resized = resize(image, maxDimension: maxDimension)
        var quality: CGFloat = 0.85
        var data = resized.jpegData(compressionQuality: quality)
        while let d = data, d.count > targetBytes, quality > minQuality {
            quality -= 0.1
            data = resized.jpegData(compressionQuality: quality)
        }
        return data
    }

    private static func resize(_ image: UIImage, maxDimension: CGFloat) -> UIImage {
        let size = image.size
        let longest = max(size.width, size.height)
        guard longest > maxDimension else { return image }
        let scale = maxDimension / longest
        let target = CGSize(width: size.width * scale, height: size.height * scale)
        let format = UIGraphicsImageRendererFormat.default()
        format.scale = 1
        let renderer = UIGraphicsImageRenderer(size: target, format: format)
        return renderer.image { _ in
            image.draw(in: CGRect(origin: .zero, size: target))
        }
    }
}
