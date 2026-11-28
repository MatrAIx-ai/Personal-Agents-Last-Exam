# FreshCart task subset

Task-local grocery subset for grocery-cap-limit-code. It keeps the shared list, cart, price preview, saved payments, checkout attempts, substitution offers and order history. Keelcard decides the card charge. Infra publishes the channel.card.authorization message through the test-merchant contract and writes the decision back with freshcart.checkout.decide.
