import AppKit

@main
struct IconBuilder {
    static func color(_ hex: UInt32, alpha: CGFloat = 1) -> NSColor {
        NSColor(srgbRed: CGFloat((hex >> 16) & 255) / 255, green: CGFloat((hex >> 8) & 255) / 255, blue: CGFloat(hex & 255) / 255, alpha: alpha)
    }
    static func rect(_ x: CGFloat, _ y: CGFloat, _ w: CGFloat, _ h: CGFloat, _ hex: UInt32) {
        color(hex).setFill()
        NSBezierPath(rect: NSRect(x: x, y: y, width: w, height: h)).fill()
    }
    static func polygon(_ points: [(CGFloat, CGFloat)], _ hex: UInt32) {
        let path = NSBezierPath()
        path.move(to: NSPoint(x: points[0].0, y: points[0].1))
        points.dropFirst().forEach { path.line(to: NSPoint(x: $0.0, y: $0.1)) }
        path.close()
        color(hex).setFill()
        path.fill()
    }
    static func draw() {
        let boundary = NSBezierPath(roundedRect: NSRect(x: 9, y: 9, width: 142, height: 142), xRadius: 32, yRadius: 32)
        NSGradient(starting: color(0xeee6cf), ending: color(0xc4c8a0))!.draw(in: boundary, angle: -65)
        NSGraphicsContext.saveGraphicsState()
        boundary.addClip()
        color(0x9f623f).setFill()
        NSBezierPath(ovalIn: NSRect(x: 31, y: 33, width: 99, height: 24)).fill()
        color(0xd09a5b).setFill()
        NSBezierPath(ovalIn: NSRect(x: 38, y: 42, width: 84, height: 68)).fill()
        color(0x65422b).setStroke()
        let edge = NSBezierPath(ovalIn: NSRect(x: 38, y: 42, width: 84, height: 68))
        edge.lineWidth = 2
        edge.stroke()
        polygon([(39,65),(58,75),(88,77),(119,68),(120,61),(87,69),(58,68),(40,59)], 0x65422b)
        rect(55, 88, 30, 3, 0xefd0a0)
        rect(48, 82, 11, 3, 0xefd0a0)
        rect(58, 55, 26, 2, 0xefd0a0)
        polygon([(107,99),(114,103),(85,133),(79,128)], 0x805332)
        color(0xb77b47).setFill()
        NSBezierPath(ovalIn: NSRect(x: 65, y: 120, width: 25, height: 19)).fill()
        color(0xeec798).setFill()
        NSBezierPath(ovalIn: NSRect(x: 66, y: 126, width: 20, height: 11)).fill()
        for (x,y) in [(27,72),(127,96),(31,111)] { rect(CGFloat(x),CGFloat(y),3,3,0xfaf1d3) }
        NSGraphicsContext.restoreGraphicsState()
    }
    static func main() throws {
        let output = URL(fileURLWithPath: CommandLine.arguments[1], isDirectory: true)
        try FileManager.default.createDirectory(at: output, withIntermediateDirectories: true)
        for (base, multiplier) in [(16,1),(16,2),(32,1),(32,2),(128,1),(128,2),(256,1),(256,2),(512,1),(512,2)] {
            let size = base * multiplier
            let bitmap = NSBitmapImageRep(bitmapDataPlanes: nil, pixelsWide: size, pixelsHigh: size, bitsPerSample: 8, samplesPerPixel: 4, hasAlpha: true, isPlanar: false, colorSpaceName: .deviceRGB, bytesPerRow: 0, bitsPerPixel: 0)!
            NSGraphicsContext.saveGraphicsState()
            let context = NSGraphicsContext(bitmapImageRep: bitmap)!
            NSGraphicsContext.current = context
            context.cgContext.scaleBy(x: CGFloat(size) / 160, y: CGFloat(size) / 160)
            draw()
            NSGraphicsContext.restoreGraphicsState()
            let name = "icon_\(base)x\(base)" + (multiplier == 2 ? "@2x" : "") + ".png"
            try bitmap.representation(using: .png, properties: [:])!.write(to: output.appendingPathComponent(name))
        }
    }
}
