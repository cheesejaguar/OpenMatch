import SwiftUI

private struct OMDisplayLargeStyle: ViewModifier {
    func body(content: Content) -> some View {
        content
            .font(OMFont.largeTitleItalic)
            .tracking(-0.5)
            .foregroundStyle(OMColor.ink)
    }
}

private struct OMTitleStyle: ViewModifier {
    func body(content: Content) -> some View {
        content
            .font(OMFont.title)
            .tracking(-0.2)
            .foregroundStyle(OMColor.ink)
    }
}

private struct OMHeadlineStyle: ViewModifier {
    func body(content: Content) -> some View {
        content
            .font(OMFont.subhead)
            .foregroundStyle(OMColor.ink)
    }
}

private struct OMBodyStyle: ViewModifier {
    func body(content: Content) -> some View {
        content
            .font(OMFont.bodyRegular)
            .foregroundStyle(OMColor.ink)
    }
}

private struct OMCalloutStyle: ViewModifier {
    func body(content: Content) -> some View {
        content
            .font(OMFont.callout)
            .foregroundStyle(OMColor.inkMuted)
    }
}

private struct OMCaptionStyle: ViewModifier {
    func body(content: Content) -> some View {
        content
            .font(OMFont.caption)
            .foregroundStyle(OMColor.inkMuted)
    }
}

extension View {
    func omDisplayLarge() -> some View { modifier(OMDisplayLargeStyle()) }
    func omTitle() -> some View { modifier(OMTitleStyle()) }
    func omHeadline() -> some View { modifier(OMHeadlineStyle()) }
    func omBody() -> some View { modifier(OMBodyStyle()) }
    func omCallout() -> some View { modifier(OMCalloutStyle()) }
    func omCaption() -> some View { modifier(OMCaptionStyle()) }
}
