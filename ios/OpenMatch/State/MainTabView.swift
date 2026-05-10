import SwiftUI

struct MainTabView: View {
    enum Tab: Hashable { case swipe, likes, chat, profile }

    @State private var selection: Tab = .swipe

    var body: some View {
        TabView(selection: $selection) {
            SwipeDeckView()
                .tabItem {
                    Label("Swipe", systemImage: "rectangle.stack.fill")
                }
                .tag(Tab.swipe)

            LikesView()
                .tabItem {
                    Label("Likes", systemImage: "heart.fill")
                }
                .tag(Tab.likes)

            ChatListView()
                .tabItem {
                    Label("Chat", systemImage: "bubble.left.and.bubble.right.fill")
                }
                .tag(Tab.chat)

            ProfileHomeView()
                .tabItem {
                    Label("Profile", systemImage: "person.crop.circle.fill")
                }
                .tag(Tab.profile)
        }
        .tint(OMColor.like)
    }
}
